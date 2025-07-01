import { useState, useEffect, useRef } from "react"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages])

  const sendMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    // Add the user message optimistically
    const userMsg: ChatMessage = { role: "user", content: trimmed }
    setMessages((prev) => [...prev, userMsg])
    setInput("")

    try {
      // Send full conversation so far to the backend (including the new user message)
      const assistantMsg = await (window as any).electronAPI.sendChatMessage([
        ...messages,
        userMsg
      ])
      if (assistantMsg && assistantMsg.role === "assistant") {
        setMessages((prev) => [...prev, assistantMsg])
      } else if (assistantMsg?.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: assistantMsg.error }
        ])
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: error?.message || "Error" }
      ])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleClear = () => setMessages([])

  return (
    <div
      className="flex flex-col h-screen p-4 bg-black/60 backdrop-blur-md text-white/90 relative"
      style={{ fontSize: 'inherit' }}
    >
      {/* Draggable borders */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 16, WebkitAppRegion: 'drag', zIndex: 30 } as React.CSSProperties} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 16, WebkitAppRegion: 'drag', zIndex: 30 } as React.CSSProperties} />
      <div style={{ position: 'absolute', top: 0, left: 0, width: 16, height: '100%', WebkitAppRegion: 'drag', zIndex: 30 } as React.CSSProperties} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 16, height: '100%', WebkitAppRegion: 'drag', zIndex: 30 } as React.CSSProperties} />
      <button
        onClick={handleClear}
        className="absolute top-4 right-4 text-xs bg-white/10 hover:bg-white/20 text-white/70 rounded px-3 py-1 cursor-pointer z-10"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        Clear Chat
      </button>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-4 pr-2"
      >
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.role === "user" ? "text-right" : "text-left"}>
            <span
              className={`inline-block px-3 py-2 rounded-lg max-w-[80%] whitespace-pre-wrap ${
                "bg-white/10 text-white/90"
              }`}
            >
              {msg.content}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <textarea
          className="w-full h-28 resize-none rounded-lg bg-white/5 text-white/90 placeholder-gray-400 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-white/10"
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        />
      </div>
    </div>
  )
}

export default Chat 