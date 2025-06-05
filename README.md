# YouTube Video Downloader

A personal-use YouTube video downloader web application built with Node.js, Express, and @distube/ytdl-core.

## Features

- Download YouTube videos in various MP4 qualities
- Automatic merging of video and audio streams for best quality
- Modern, responsive UI
- Simple and intuitive interface
- Displays video title, thumbnail, and available formats
- Shows file size and quality information
- Visual indicators for audio availability
- Supports high-quality video formats with separate audio streams
- Automatic FFmpeg integration for stream merging

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation

1. Clone this repository or download the files
2. Navigate to the project directory
3. Install dependencies:

```bash
npm install
```

## Usage

1. Start the server:

```bash
npm start
```

2. Open your browser and navigate to:

```
http://localhost:3000
```

3. Enter a YouTube URL in the input field
4. Click "Fetch Formats"
5. Select your preferred format and click "Download"

## How It Works

- For formats that already include both video and audio, the download is streamed directly
- For high-quality formats that contain only video (no audio), the application:
  1. Automatically finds the best available audio stream
  2. Uses FFmpeg to merge the video and audio streams on-the-fly
  3. Delivers a complete video file with audio to the user

## Development

The server automatically restarts when files change:

```bash
npm start
```

## Notes

- This application is intended for personal use only
- Please respect copyright laws and YouTube's Terms of Service
- Some videos may not be available for download due to restrictions
- The application uses @distube/ytdl-core for video extraction
- FFmpeg is used for stream merging when necessary

## Dependencies

- express: Web server framework
- @distube/ytdl-core: YouTube downloading library
- fluent-ffmpeg: FFmpeg wrapper for Node.js
- ffmpeg-static: FFmpeg binaries for Node.js
- cors: Cross-origin resource sharing
- node-fetch: HTTP client
- nodemon: Auto-restart during development 