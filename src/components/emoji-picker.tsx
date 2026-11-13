"use client";

import { useMemo, useState } from "react";
import { Shuffle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Curated set (keeps the bundle small). Format: "emoji keywords…".
const GROUPS: { name: string; items: string[] }[] = [
  {
    name: "Work",
    items: [
      "📄 page document file", "📝 memo note write", "📌 pin", "📎 clip attach", "📁 folder", "🗂️ dividers index",
      "📊 chart bar stats", "📈 chart up growth", "📉 chart down", "🗓️ calendar date", "⏰ alarm clock time",
      "✅ check done", "☑️ checkbox", "🎯 target goal", "🚀 rocket launch ship", "💡 idea bulb", "🔖 bookmark",
      "🧭 compass direction", "🧩 puzzle piece", "🛠️ tools build", "⚙️ gear settings", "🔒 lock private",
      "🔑 key", "📦 package box", "🏷️ label tag", "📣 megaphone announce", "💬 chat comment", "📬 mailbox inbox",
      "✉️ email letter", "🗃️ card box archive", "🧾 receipt", "💼 briefcase work", "🖥️ desktop computer",
      "💻 laptop", "📱 phone mobile", "🧪 test experiment", "🔬 research microscope", "🧠 brain think",
      "🗺️ map plan roadmap", "🏁 finish flag", "🚩 flag", "⭐ star favorite", "🔥 fire hot", "⚡ bolt fast",
      "🧱 brick foundation", "🦴 bone skele", "💀 skull skele", "🏗️ construction", "🔗 link",
    ],
  },
  {
    name: "Life",
    items: [
      "🏠 home house", "🌱 seedling grow", "🌿 herb", "🌸 blossom flower", "🌞 sun", "🌙 moon night", "☁️ cloud",
      "🌊 wave ocean", "⛰️ mountain", "🏖️ beach vacation", "✈️ plane travel", "🚲 bike", "🚗 car", "🍎 apple food",
      "🥑 avocado", "☕ coffee", "🍵 tea", "🍕 pizza", "🍰 cake", "🎂 birthday", "🎁 gift present", "🎉 party tada",
      "🎵 music note", "🎧 headphones", "🎮 game controller", "📚 books library", "📖 book read", "✏️ pencil",
      "🖌️ brush paint art", "📷 camera photo", "🎬 film movie", "🏋️ gym workout", "🧘 yoga meditate",
      "⚽ soccer sport", "🏀 basketball", "💪 strong muscle", "❤️ heart love", "💚 green heart", "💙 blue heart",
      "💜 purple heart", "🧡 orange heart", "🖤 black heart", "💰 money", "💳 card payment", "🛒 cart shopping",
      "🐶 dog", "🐱 cat", "🦊 fox", "🐻 bear", "🐼 panda", "🐸 frog", "🦉 owl", "🐝 bee", "🦋 butterfly",
    ],
  },
  {
    name: "Faces",
    items: [
      "😀 grin happy", "😄 smile", "😊 blush", "🙂 slight smile", "😉 wink", "😍 heart eyes", "🤩 star struck",
      "😎 cool sunglasses", "🤓 nerd", "🤔 thinking", "😴 sleep", "😅 sweat", "😂 joy laugh", "🥳 party",
      "😮 wow", "😬 grimace", "🙃 upside", "😇 angel", "🤖 robot", "👻 ghost", "👋 wave hello", "👍 thumbs up",
      "👏 clap", "🙌 raise hands", "🤝 handshake", "✌️ peace", "👀 eyes look", "🙏 pray thanks",
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.items.map((i) => ({ emoji: i.split(" ")[0], keywords: i, group: g.name })));

export function EmojiPicker({ onSelect, onRemove }: { onSelect: (emoji: string) => void; onRemove?: () => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ALL.filter((e) => e.keywords.includes(q)) : null;
  }, [query]);

  const grid = (items: typeof ALL) => (
    <div className="grid grid-cols-9 gap-0.5">
      {items.map((e) => (
        <button
          key={e.emoji + e.group}
          type="button"
          title={e.keywords.split(" ").slice(1).join(", ")}
          onClick={() => onSelect(e.emoji)}
          className="flex size-8 items-center justify-center rounded-md text-xl hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div className="w-[320px]">
      <div className="flex items-center gap-1.5 border-b p-2">
        <Input
          autoFocus
          placeholder="Search emoji…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          title="Random"
          onClick={() => onSelect(ALL[Math.floor(Math.random() * ALL.length)].emoji)}
        >
          <Shuffle />
        </Button>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="max-h-[280px] overflow-y-auto p-2 scrollbar-thin">
        {results ? (
          results.length ? (
            grid(results)
          ) : (
            <p className="py-6 text-center text-muted-foreground">No emoji found</p>
          )
        ) : (
          GROUPS.map((g) => (
            <div key={g.name} className={cn("mb-2")}>
              <p className="mb-1 px-1 text-xs font-medium text-muted-foreground">{g.name}</p>
              {grid(ALL.filter((e) => e.group === g.name))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
