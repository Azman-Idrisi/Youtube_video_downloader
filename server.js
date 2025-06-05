const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Vercel serverless environment detection
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || process.env.VERCEL_ENV;

// Enhanced cookie and agent management for better compatibility
const getRandomUserAgent = () => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const getRequestOptions = () => {
  return {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    },
    // Increase timeout for Vercel
    timeout: 30000
  };
};

/**
 * Check if ytdl-core is working
 */
async function checkYtdlCore() {
  try {
    const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    return ytdl.validateURL(testUrl);
  } catch (error) {
    console.error('ytdl-core check failed:', error.message);
    return false;
  }
}

/**
 * Extract video information with enhanced error handling for Vercel
 */
async function getVideoInfo(url) {
  try {
    if (!ytdl.validateURL(url)) {
      throw new Error('Invalid YouTube URL');
    }

    console.log('Fetching video info for:', url);
    console.log('Environment:', isVercel ? 'Vercel' : 'Local');

    const maxRetries = isVercel ? 5 : 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries}`);
        
        const requestOptions = getRequestOptions();
        
        // Add additional options for Vercel environment
        const ytdlOptions = {
          requestOptions,
          // Use IPv4 to avoid potential IPv6 issues in serverless
          family: 4
        };

        console.log('Request options:', JSON.stringify(requestOptions.headers, null, 2));

        const info = await Promise.race([
          ytdl.getInfo(url, ytdlOptions),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), 25000)
          )
        ]);
        
        console.log('Successfully retrieved video info');
        
        const videoDetails = info.videoDetails;
        
        if (!videoDetails) {
          throw new Error('No video details found');
        }

        // Filter and process formats
        let availableFormats = info.formats.filter(format => {
          return format.hasVideo && 
                 format.container === 'mp4' &&
                 format.height &&
                 format.height >= 144 &&
                 format.itag;
        });

        console.log(`Found ${availableFormats.length} video formats`);

        // If no video+audio formats, include video-only formats
        if (availableFormats.length === 0) {
          availableFormats = info.formats.filter(format => {
            return format.hasVideo && 
                   format.height &&
                   format.height >= 144 &&
                   format.itag;
          });
          console.log(`Using extended filter, found ${availableFormats.length} formats`);
        }

        // Sort by quality (height) descending
        availableFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

        // Remove duplicates and create clean format objects
        const uniqueFormats = [];
        const seenHeights = new Set();
        
        for (const format of availableFormats) {
          const height = format.height;
          if (!seenHeights.has(height) && format.itag) {
            seenHeights.add(height);
            
            let filesize = null;
            if (format.contentLength) {
              filesize = parseInt(format.contentLength);
            } else if (format.bitrate && videoDetails.lengthSeconds) {
              filesize = Math.floor((format.bitrate * parseInt(videoDetails.lengthSeconds)) / 8);
            }

            const cleanFormat = {
              itag: format.itag,
              ext: format.container || 'mp4',
              height: height,
              width: format.width,
              fps: format.fps || 30,
              filesize: filesize,
              quality_label: `${height}p${(format.fps && format.fps > 30) ? format.fps : ''}`,
              qualityLabel: format.qualityLabel || `${height}p`,
              bitrate: format.bitrate,
              hasAudio: format.hasAudio || false,
              hasVideo: format.hasVideo || false,
              isAdaptive: !format.hasAudio,
              url: format.url // Include URL for direct downloads if needed
            };

            uniqueFormats.push(cleanFormat);
          }
        }

        console.log(`Processed ${uniqueFormats.length} unique formats`);

        if (uniqueFormats.length === 0) {
          throw new Error('No compatible formats found for this video');
        }

        const result = {
          title: videoDetails.title || 'Unknown Title',
          duration: parseInt(videoDetails.lengthSeconds) || 0,
          thumbnail: videoDetails.thumbnails && videoDetails.thumbnails.length > 0 
            ? videoDetails.thumbnails[videoDetails.thumbnails.length - 1].url 
            : null,
          uploader: videoDetails.author?.name || 'Unknown Channel',
          viewCount: videoDetails.viewCount || '0',
          uploadDate: videoDetails.uploadDate || null,
          description: videoDetails.shortDescription || '',
          formats: uniqueFormats,
          success: true
        };

        console.log('Successfully processed video info:', result.title);
        return result;

      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        // Check for specific YouTube errors
        if (error.message.includes('Video unavailable')) {
          throw new Error('This video is unavailable, private, or has been removed');
        }
        
        if (error.message.includes('Sign in to confirm')) {
          throw new Error('This video requires age verification or sign-in');
        }
        
        if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
          console.log('Rate limited, waiting before retry...');
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.log(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error('Failed to fetch video info after multiple attempts');
    
  } catch (error) {
    console.error('Final error in getVideoInfo:', error.message);
    
    // Provide user-friendly error messages
    if (error.message.includes('Invalid YouTube URL')) {
      throw new Error('Please provide a valid YouTube URL');
    } else if (error.message.includes('Video unavailable')) {
      throw new Error('This video is unavailable, private, or has been removed');
    } else if (error.message.includes('Sign in to confirm')) {
      throw new Error('This video requires age verification or sign-in');
    } else if (error.message.includes('403')) {
      throw new Error('Access denied. This video may be region-restricted');
    } else if (error.message.includes('timeout')) {
      throw new Error('Request timed out. Please try again');
    } else {
      throw new Error(`Failed to fetch video information: ${error.message}`);
    }
  }
}

/**
 * Enhanced download function with better error handling
 */
async function downloadVideo(url, itag, res) {
  try {
    console.log(`Starting download for itag: ${itag}`);
    
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get video info with timeout
    const info = await Promise.race([
      ytdl.getInfo(url, getRequestOptions()),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Info fetch timeout')), 20000)
      )
    ]);

    const title = info.videoDetails.title
      .replace(/[^\w\s.-]/gi, '')
      .replace(/\s+/g, '_')
      .substring(0, 100);
    
    const filename = `${title}.mp4`;
    console.log(`Downloading: ${filename}`);

    // Set response headers
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');

    // Find the requested format
    const format = info.formats.find(f => f.itag == itag);
    if (!format) {
      return res.status(400).json({ error: 'Requested format not found' });
    }

    console.log(`Format: ${format.height}p, hasAudio: ${format.hasAudio}, hasVideo: ${format.hasVideo}`);

    // Enhanced streaming options
    const streamOptions = {
      quality: itag,
      filter: format => format.itag == itag,
      requestOptions: getRequestOptions()
    };

    const stream = ytdl(url, streamOptions);

    // Enhanced error handling for stream
    stream.on('error', (error) => {
      console.error('Stream error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Download failed', 
          details: error.message.includes('403') ? 'Access denied by YouTube' : error.message
        });
      }
    });

    stream.on('progress', (chunkLength, downloaded, total) => {
      if (total > 0) {
        const percent = (downloaded / total * 100).toFixed(1);
        console.log(`Progress: ${percent}%`);
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      console.log('Client disconnected');
      if (stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
    });

    // Pipe stream to response
    stream.pipe(res);

  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to download video', 
        details: error.message 
      });
    }
  }
}

// Routes

/**
 * GET /formats - Get available video formats
 */
app.get('/formats', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ 
      error: 'URL parameter is required',
      example: '/formats?url=https://www.youtube.com/watch?v=VIDEO_ID'
    });
  }

  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ 
      error: 'Invalid YouTube URL',
      details: 'Please provide a valid YouTube video URL'
    });
  }

  try {
    console.log('Processing formats request for:', url);
    const videoInfo = await getVideoInfo(url);
    
    // Add some metadata for the response
    videoInfo.timestamp = new Date().toISOString();
    videoInfo.server_environment = isVercel ? 'vercel' : 'local';
    
    res.json(videoInfo);
  } catch (error) {
    console.error('Error getting video info:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch video information', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /download - Download video
 */
app.get('/download', async (req, res) => {
  const { url, itag } = req.query;

  if (!url || !itag) {
    return res.status(400).json({ 
      error: 'URL and itag parameters are required',
      example: '/download?url=https://www.youtube.com/watch?v=VIDEO_ID&itag=18'
    });
  }

  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    await downloadVideo(url, itag, res);
  } catch (error) {
    console.error('Download route error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Download failed', 
        details: error.message 
      });
    }
  }
});

/**
 * GET /health - Health check
 */
app.get('/health', async (req, res) => {
  try {
    const ytdlAvailable = await checkYtdlCore();
    res.json({ 
      status: 'OK',
      timestamp: new Date().toISOString(),
      environment: isVercel ? 'vercel' : 'local',
      ytdl_available: ytdlAvailable,
      node_version: process.version,
      message: ytdlAvailable ? 'Service is ready' : 'ytdl-core may have issues'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET / - Serve main page
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    details: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    available_routes: ['/formats', '/download', '/health'],
    timestamp: new Date().toISOString()
  });
});

// Start server
if (!isVercel) {
  app.listen(PORT, async () => {
    console.log(`🚀 YouTube Downloader server running at http://localhost:${PORT}`);
    console.log(`Environment: ${isVercel ? 'Vercel' : 'Local'}`);
    
    const ytdlAvailable = await checkYtdlCore();
    console.log(`ytdl-core status: ${ytdlAvailable ? '✅ Ready' : '❌ Issues detected'}`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Export for Vercel
module.exports = app;