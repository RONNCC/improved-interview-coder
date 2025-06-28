import React from "react"
import { Screenshot } from "../../types"
import { X } from "lucide-react"

interface ScreenshotItemProps {
  screenshot: Screenshot
  onDelete: (index: number) => void
  index: number
  isLoading: boolean
}

const ScreenshotItem = ({
  screenshot,
  onDelete,
  index,
  isLoading
}: ScreenshotItemProps) => {
  return (
    <div
      className={`border border-white relative w-[128px] h-[72px] ${
        isLoading ? "" : "group"
      }`}
    >
      <div className="w-full h-full relative">
        {isLoading && (
          <div className="absolute inset-0 bg-black bg-opacity-50 z-10 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <img
          src={screenshot.preview}
          alt="Screenshot"
          className={`w-full h-full object-cover transition-transform duration-300 ${
            isLoading
              ? "opacity-50"
              : "cursor-pointer group-hover:scale-105 group-hover:brightness-75"
          }`}
        />
      </div>
      {!isLoading && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(index)
          }}
          className="absolute top-2 left-2 p-1 rounded-full bg-black bg-opacity-50 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          aria-label="Delete screenshot"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}

interface ScreenshotQueueProps {
  isLoading: boolean
  screenshots: Screenshot[]
  onDeleteScreenshot: (index: number) => void
}
const ScreenshotQueue = ({
  isLoading,
  screenshots,
  onDeleteScreenshot
}: ScreenshotQueueProps) => {
  if (screenshots.length === 0) {
    return null
  }

  const displayScreenshots = screenshots.slice(0, 5)

  return (
    <div className="flex gap-4">
      {displayScreenshots.map((screenshot, index) => (
        <ScreenshotItem
          key={screenshot.path}
          isLoading={isLoading}
          screenshot={screenshot}
          index={index}
          onDelete={onDeleteScreenshot}
        />
      ))}
    </div>
  )
}

export default ScreenshotQueue
