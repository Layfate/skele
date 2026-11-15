//! Reads an image from the system clipboard for the AI chat's Alt+V (Ctrl+V uses the
//! webview's own paste event). On Windows it takes, in order: a PNG (what browsers and most
//! apps put there), a bitmap (screenshots, Snipping Tool), or an image file copied in File
//! Explorer. The page decodes the bytes and re-encodes them before sending.
//!
//! Other platforms return nothing here; the page falls back to `navigator.clipboard.read()`.

type CmdResult<T> = Result<T, String>;

/// Largest image (or copied image file) read from the clipboard.
#[cfg(windows)]
const MAX_BYTES: usize = 40 * 1024 * 1024;

/// The clipboard image as raw bytes (PNG, BMP, JPEG, GIF or WebP); empty when there's none.
#[tauri::command]
pub async fn clipboard_image() -> CmdResult<tauri::ipc::Response> {
    let bytes = tauri::async_runtime::spawn_blocking(imp::read)
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A BMP file for a packed DIB (`BITMAPINFOHEADER` + colour table + pixels): the DIB with a
/// 14-byte file header in front, so an image decoder can read it.
#[cfg(any(windows, test))]
fn bmp_from_dib(dib: &[u8]) -> Option<Vec<u8>> {
    let u32_at = |i: usize| {
        dib.get(i..i + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let header = u32_at(0)? as usize;
    if header < 12 || header > dib.len() {
        return None;
    }
    let (bit_count, compression, colors_used) = if header == 12 {
        (u16::from_le_bytes([dib[10], dib[11]]), 0, 0)
    } else {
        (
            u16::from_le_bytes([*dib.get(14)?, *dib.get(15)?]),
            u32_at(16)?,
            u32_at(32)?,
        )
    };
    let entry = if header == 12 { 3 } else { 4 };
    let mut palette = if colors_used > 0 {
        colors_used as usize * entry
    } else if bit_count <= 8 {
        (1usize << bit_count) * entry
    } else {
        0
    };
    // BI_BITFIELDS with the plain 40-byte header: three colour masks follow it.
    if header == 40 && compression == 3 {
        palette += 12;
    }
    let offset = 14 + header + palette;
    let size = 14 + dib.len();
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(offset as u32).to_le_bytes());
    out.extend_from_slice(dib);
    Some(out)
}

#[cfg(any(windows, test))]
fn is_image_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

#[cfg(windows)]
mod imp {
    use super::{bmp_from_dib, is_image_file, CmdResult, MAX_BYTES};
    use windows::core::w;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::{CF_DIB, CF_HDROP};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    /// Closes the clipboard however reading ends.
    struct Open;
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn open() -> Option<Open> {
        // Another app may hold the clipboard for a moment.
        for _ in 0..10 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Some(Open);
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        None
    }

    /// The bytes of a clipboard format held in global memory.
    fn global_bytes(format: u32) -> Option<Vec<u8>> {
        unsafe {
            IsClipboardFormatAvailable(format).ok()?;
            let handle: HANDLE = GetClipboardData(format).ok()?;
            let global = HGLOBAL(handle.0);
            let size = GlobalSize(global);
            if size == 0 || size > MAX_BYTES {
                return None;
            }
            let ptr = GlobalLock(global) as *const u8;
            if ptr.is_null() {
                return None;
            }
            let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
            let _ = GlobalUnlock(global);
            Some(bytes)
        }
    }

    /// The first image file copied in File Explorer, if any.
    fn copied_file() -> Option<Vec<u8>> {
        unsafe {
            IsClipboardFormatAvailable(CF_HDROP.0 as u32).ok()?;
            let handle = GetClipboardData(CF_HDROP.0 as u32).ok()?;
            let drop = HDROP(handle.0);
            let count = DragQueryFileW(drop, u32::MAX, None);
            for i in 0..count {
                let len = DragQueryFileW(drop, i, None) as usize;
                let mut buf = vec![0u16; len + 1];
                DragQueryFileW(drop, i, Some(&mut buf));
                let path = String::from_utf16_lossy(&buf[..len]);
                if !is_image_file(&path) {
                    continue;
                }
                let meta = std::fs::metadata(&path).ok()?;
                if meta.len() as usize > MAX_BYTES {
                    return None;
                }
                return std::fs::read(&path).ok();
            }
            None
        }
    }

    pub fn read() -> CmdResult<Vec<u8>> {
        let Some(_open) = open() else {
            return Err("Couldn't open the clipboard. Try again.".into());
        };
        let png = unsafe { RegisterClipboardFormatW(w!("PNG")) };
        if png != 0 {
            if let Some(bytes) = global_bytes(png) {
                return Ok(bytes);
            }
        }
        if let Some(bytes) = global_bytes(CF_DIB.0 as u32).and_then(|dib| bmp_from_dib(&dib)) {
            return Ok(bytes);
        }
        Ok(copied_file().unwrap_or_default())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::CmdResult;

    pub fn read() -> CmdResult<Vec<u8>> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_a_dib_in_a_bmp_header() {
        // 1×1, 32 bits per pixel, BI_RGB: 40-byte header + 4 bytes of pixels.
        let mut dib = vec![0u8; 44];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&1i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        let bmp = bmp_from_dib(&dib).unwrap();
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes([bmp[2], bmp[3], bmp[4], bmp[5]]), 58);
        assert_eq!(u32::from_le_bytes([bmp[10], bmp[11], bmp[12], bmp[13]]), 54);
        // BI_BITFIELDS adds the three colour masks to the offset.
        dib[16..20].copy_from_slice(&3u32.to_le_bytes());
        let bmp = bmp_from_dib(&dib).unwrap();
        assert_eq!(u32::from_le_bytes([bmp[10], bmp[11], bmp[12], bmp[13]]), 66);
        assert!(bmp_from_dib(&[1, 2]).is_none());
    }

    #[test]
    fn image_files_by_extension() {
        assert!(is_image_file(r"C:\shots\a.PNG"));
        assert!(is_image_file("/tmp/b.jpeg"));
        assert!(!is_image_file("notes.txt"));
    }
}
