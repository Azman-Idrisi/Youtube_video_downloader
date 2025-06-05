# YouTube Video Downloader

A web application that allows users to download YouTube videos in various formats and qualities. Built with Node.js, Express, and modern web technologies.

## Features

- 📺 Download YouTube videos in multiple quality options
- 🎵 Download videos with audio
- 🎞️ Support for high-quality video formats (1080p, 1440p, 4K)
- 🔄 Automatic merging of video and audio streams for best quality
- 📱 Responsive design that works on desktop and mobile

## Deployment Options

This application can be deployed in two ways, each with different capabilities:

### 1. Local/Self-hosted Deployment

When running the application locally or on a traditional server:

- ✅ All features are fully supported
- ✅ High-quality video formats work properly
- ✅ Audio and video merging is available
- ✅ No limitations on file operations

### 2. Vercel/Serverless Deployment

When deployed on Vercel or other serverless platforms:

- ✅ Basic video downloads work
- ✅ Formats with combined audio and video work
- ❌ High-quality formats that require merging are disabled
- ❌ File system operations are limited due to serverless environment restrictions

## Why are there limitations on Vercel?

Vercel's serverless functions run in a read-only filesystem environment with the following constraints:

1. **No file system write access**: Serverless functions cannot write to the filesystem except for the `/tmp` directory
2. **Limited `/tmp` space**: The `/tmp` directory has limited space (around 512MB)
3. **Execution time limits**: Serverless functions have execution time limits (usually 10-60 seconds)
4. **Ephemeral environment**: Files in `/tmp` are not guaranteed to persist between function invocations

These limitations prevent the application from merging separate audio and video streams, which is necessary for high-quality formats (1080p and above) that YouTube provides as separate streams.

## Technical Details

The application uses:

- `@distube/ytdl-core` for extracting YouTube video information and downloading
- `fluent-ffmpeg` for merging audio and video streams (local deployment only)
- `express` for the web server
- Modern JavaScript and responsive design

## Setup and Running Locally

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Run the server:
   ```
   node server.js
   ```
4. Access the application at `http://localhost:3000`

## Deploying to Vercel

1. Fork this repository
2. Connect your fork to Vercel
3. Deploy
4. Note that high-quality formats requiring audio/video merging will be disabled in the Vercel deployment

## License

MIT License 