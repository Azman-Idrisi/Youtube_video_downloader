const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const puppeteer = require('puppeteer');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/**
 * Check if ytdl-core is working
 */
async function checkYtdlCore() {
  try {
    // Test with a simple YouTube URL validation
    const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    return ytdl.validateURL(testUrl);
  } catch (error) {
    return false;
  }
}

/**
 * Extract video information using Puppeteer (more reliable than ytdl-core)
 * @param {string} url - YouTube video URL
 * @returns {Promise} Video info and formats
 */
async function getVideoInfoWithPuppeteer(url) {
  let browser = null;
  
  try {
    console.log('Fetching video info with Puppeteer for:', url);
    
    // Use ytdl-core first to validate the URL and get basic info
    if (!ytdl.validateURL(url)) {
      throw new Error('Invalid YouTube URL');
    }

    // Try to get info directly with ytdl-core first
    try {
      console.log('Attempting to get info with ytdl-core first');
      const info = await ytdl.getInfo(url, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Referer': 'https://www.youtube.com/',
          }
        }
      });
      
      const videoDetails = info.videoDetails;
      console.log('Successfully retrieved info with ytdl-core');
      
      // Filter formats
      let availableFormats = info.formats.filter(format => {
        return format.hasVideo && 
              format.container === 'mp4' &&
              format.height &&
              format.height >= 144;
      });

      // Sort by quality (height) descending
      availableFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

      // Remove duplicates based on height
      const uniqueFormats = [];
      const seenHeights = new Set();
      
      for (const format of availableFormats) {
        if (!seenHeights.has(format.height) && format.itag) {
          seenHeights.add(format.height);
          
          // Calculate approximate file size if not available
          let filesize = null;
          if (format.contentLength) {
            filesize = parseInt(format.contentLength);
          } else if (format.bitrate && videoDetails.lengthSeconds) {
            // Rough estimation: bitrate * duration / 8
            filesize = Math.floor((format.bitrate * parseInt(videoDetails.lengthSeconds)) / 8);
          }

          uniqueFormats.push({
            itag: format.itag,
            ext: 'mp4',
            height: format.height,
            width: format.width,
            fps: format.fps || 30,
            filesize: filesize,
            quality_label: `${format.height}p${(format.fps && format.fps > 30) ? format.fps : ''}`,
            qualityLabel: format.qualityLabel || `${format.height}p`,
            bitrate: format.bitrate,
            hasAudio: format.hasAudio || false,
            hasVideo: format.hasVideo || false,
            isAdaptive: !format.hasAudio
          });
        }
      }

      if (uniqueFormats.length > 0) {
        return {
          title: videoDetails.title,
          duration: parseInt(videoDetails.lengthSeconds),
          thumbnail: videoDetails.thumbnails && videoDetails.thumbnails.length > 0 
            ? videoDetails.thumbnails[videoDetails.thumbnails.length - 1].url 
            : null,
          uploader: videoDetails.author.name,
          viewCount: videoDetails.viewCount,
          formats: uniqueFormats
        };
      }
      
      console.log('No formats found with ytdl-core, falling back to Puppeteer');
    } catch (ytdlError) {
      console.log('ytdl-core failed, falling back to Puppeteer:', ytdlError.message);
    }
    
    // If we're here, ytdl-core failed or found no formats, try Puppeteer as fallback
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-features=site-per-process',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    // Create a new incognito browser context
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    
    // Set longer timeouts
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(60000);
    
    // Block unnecessary resources to speed up page load
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    console.log(`Attempting to navigate to ${url}`);
    
    // Navigate directly to the URL
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    console.log('Page loaded, extracting basic info');
    
    // Extract basic video info using meta tags (more reliable)
    const videoInfo = await page.evaluate(() => {
      const getMetaContent = (name) => {
        const meta = document.querySelector(`meta[${name}]`);
        return meta ? meta.getAttribute('content') : null;
      };
      
      const title = 
        document.querySelector('meta[property="og:title"]')?.content || 
        document.querySelector('title')?.innerText?.replace(' - YouTube', '') || 
        'Unknown Title';
      
      const thumbnail = document.querySelector('meta[property="og:image"]')?.content || '';
      
      return {
        title,
        thumbnail,
        channelName: document.querySelector('meta[name="author"]')?.content || 'Unknown Channel',
      };
    });
    
    console.log('Basic info extracted:', videoInfo.title);
    
    // Close browser to free resources
    await browser.close();
    browser = null;
    
    // Now use ytdl-core to get formats
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Referer': 'https://www.youtube.com/',
        }
      }
    });
    
    // Filter formats
    let availableFormats = info.formats.filter(format => {
      return format.hasVideo && 
             format.container === 'mp4' &&
             format.height &&
             format.height >= 144;
    });
    
    // Sort by quality (height) descending
    availableFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
    
    // Remove duplicates based on height
    const uniqueFormats = [];
    const seenHeights = new Set();
    
    for (const format of availableFormats) {
      if (!seenHeights.has(format.height) && format.itag) {
        seenHeights.add(format.height);
        
        // Calculate approximate file size if not available
        let filesize = null;
        if (format.contentLength) {
          filesize = parseInt(format.contentLength);
        } else if (format.bitrate && info.videoDetails.lengthSeconds) {
          // Rough estimation: bitrate * duration / 8
          filesize = Math.floor((format.bitrate * parseInt(info.videoDetails.lengthSeconds)) / 8);
        }
        
        uniqueFormats.push({
          itag: format.itag,
          ext: 'mp4',
          height: format.height,
          width: format.width,
          fps: format.fps || 30,
          filesize: filesize,
          quality_label: `${format.height}p${(format.fps && format.fps > 30) ? format.fps : ''}`,
          qualityLabel: format.qualityLabel || `${format.height}p`,
          bitrate: format.bitrate,
          hasAudio: format.hasAudio || false,
          hasVideo: format.hasVideo || false,
          isAdaptive: !format.hasAudio
        });
      }
    }
    
    console.log('Unique formats found:', uniqueFormats.length);
    
    return {
      title: videoInfo.title,
      duration: parseInt(info.videoDetails.lengthSeconds),
      thumbnail: videoInfo.thumbnail,
      uploader: videoInfo.channelName,
      formats: uniqueFormats
    };
  } catch (error) {
    console.error('Error in Puppeteer video info extraction:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError.message);
      }
    }
    throw new Error('Failed to extract video information: ' + error.message);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed successfully');
      } catch (closeError) {
        console.error('Error closing browser in finally block:', closeError.message);
      }
    }
  }
}

/**
 * Extract video information and available formats using @distube/ytdl-core
 * @param {string} url - YouTube video URL
 * @returns {Promise} Video info and formats
 */
async function getVideoInfo(url) {
  try {
    // Validate URL first
    if (!ytdl.validateURL(url)) {
      throw new Error('Invalid YouTube URL');
    }

    console.log('Fetching video info for:', url);

    // Get video info with additional options for better compatibility
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Referer': 'https://www.youtube.com/',
          'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1'
        }
      }
    }).catch(error => {
      console.error('ytdl.getInfo error:', error);
      throw new Error(`Failed to fetch video info: ${error.message}`);
    });

    const videoDetails = info.videoDetails;
    console.log('Video title:', videoDetails.title);
    console.log('Available formats:', info.formats.length);
    
    // Filter formats more carefully
    let availableFormats = info.formats.filter(format => {
      // Look for formats that have video
      return format.hasVideo && 
             format.container === 'mp4' &&
             format.height &&
             format.height >= 144; // Minimum quality threshold
    });

    console.log('Filtered MP4 formats with video:', availableFormats.length);

    // If no formats, try a more lenient filter
    if (availableFormats.length === 0) {
      availableFormats = info.formats.filter(format => {
        return format.container === 'mp4' && 
               format.hasVideo && 
               format.height &&
               format.height >= 144;
      });
      console.log('Using more lenient filter, formats found:', availableFormats.length);
    }

    // Sort by quality (height) descending
    availableFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

    // Remove duplicates based on height and create clean format objects
    const uniqueFormats = [];
    const seenHeights = new Set();
    
    for (const format of availableFormats) {
      if (!seenHeights.has(format.height) && format.itag) {
        seenHeights.add(format.height);
        
        // Calculate approximate file size if not available
        let filesize = null;
        if (format.contentLength) {
          filesize = parseInt(format.contentLength);
        } else if (format.bitrate && videoDetails.lengthSeconds) {
          // Rough estimation: bitrate * duration / 8
          filesize = Math.floor((format.bitrate * parseInt(videoDetails.lengthSeconds)) / 8);
        }

        uniqueFormats.push({
          itag: format.itag,
          ext: 'mp4',
          height: format.height,
          width: format.width,
          fps: format.fps || 30,
          filesize: filesize,
          quality_label: `${format.height}p${(format.fps && format.fps > 30) ? format.fps : ''}`,
          qualityLabel: format.qualityLabel || `${format.height}p`,
          bitrate: format.bitrate,
          hasAudio: format.hasAudio || false,
          hasVideo: format.hasVideo || false,
          isAdaptive: !format.hasAudio // Video-only adaptive formats
        });
      }
    }

    console.log('Unique formats found:', uniqueFormats.length);

    if (uniqueFormats.length === 0) {
      throw new Error('No compatible MP4 formats found for this video');
    }

    return {
      title: videoDetails.title,
      duration: parseInt(videoDetails.lengthSeconds),
      thumbnail: videoDetails.thumbnails && videoDetails.thumbnails.length > 0 
        ? videoDetails.thumbnails[videoDetails.thumbnails.length - 1].url 
        : null,
      uploader: videoDetails.author.name,
      viewCount: videoDetails.viewCount,
      formats: uniqueFormats
    };
  } catch (error) {
    console.error('Error in getVideoInfo:', error.message);
    
    // Provide more specific error messages
    if (error.message.includes('Video unavailable')) {
      throw new Error('This video is unavailable or private');
    } else if (error.message.includes('Could not extract functions')) {
      throw new Error('YouTube has updated their systems. Please try again later or use a different video');
    } else if (error.message.includes('403')) {
      throw new Error('Access denied. This video may be region-restricted');
    } else {
      throw new Error('Failed to extract video information: ' + error.message);
    }
  }
}

/**
 * Download video with specified format using @distube/ytdl-core
 * @param {string} url - YouTube video URL
 * @param {string} itag - Format itag to download
 * @param {Object} res - Express response object
 */
async function downloadVideo(url, itag, res) {
  try {
    console.log(`Starting download for itag: ${itag}`);
    
    // Validate URL
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get video info to get the title for filename
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title
      .replace(/[^\w\s.-]/gi, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length
    
    const filename = `${title}.mp4`;

    console.log(`Downloading: ${filename}`);

    // Set response headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');

    // Get the specific format
    const format = info.formats.find(f => f.itag == itag);
    if (!format) {
      return res.status(400).json({ error: 'Requested format not found' });
    }

    console.log(`Format found: ${format.height}p, hasAudio: ${format.hasAudio}, hasVideo: ${format.hasVideo}`);

    // Check if the format has both video and audio
    if (format.hasVideo && format.hasAudio) {
      console.log('Format has both video and audio, streaming directly');
      // Create download stream with specified quality
      const stream = ytdl(url, {
        quality: itag,
        filter: format => format.itag == itag,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      });

      // Handle stream events
      stream.on('error', (error) => {
        console.error('Stream error:', error);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Download failed', 
            details: error.message 
          });
        }
      });

      stream.on('progress', (chunkLength, downloaded, total) => {
        if (total > 0) {
          const percent = (downloaded / total * 100).toFixed(1);
          console.log(`Download progress: ${percent}% (${downloaded}/${total} bytes)`);
        }
      });

      // Pipe the stream to response
      stream.pipe(res);
    } else {
      console.log('Format is video-only, merging with best audio stream');
      
      // Find the best audio format
      const audioFormats = info.formats
        .filter(f => f.hasAudio && !f.hasVideo)
        .sort((a, b) => b.audioBitrate - a.audioBitrate);
      
      if (audioFormats.length === 0) {
        console.log('No audio formats found, streaming video only');
        ytdl(url, { quality: itag }).pipe(res);
        return;
      }
      
      const bestAudioFormat = audioFormats[0];
      console.log(`Best audio format found: ${bestAudioFormat.audioBitrate}kbps (${bestAudioFormat.itag})`);
      
      // Create temporary files for video and audio
      let tempDir = path.join(__dirname, 'temp');
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        try {
          fs.mkdirSync(tempDir, { recursive: true });
          console.log('Created temp directory:', tempDir);
        } catch (err) {
          console.error('Error creating temp directory:', err);
          // Fall back to /tmp for serverless environments
          tempDir = '/tmp';
        }
      }
      
      const tempVideoPath = path.join(tempDir, `video-${Date.now()}.mp4`);
      const tempAudioPath = path.join(tempDir, `audio-${Date.now()}.mp4`);
      const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);
      
      // Download video and audio to temporary files
      const videoWriteStream = fs.createWriteStream(tempVideoPath);
      const audioWriteStream = fs.createWriteStream(tempAudioPath);
      
      const videoStream = ytdl(url, { 
        quality: itag,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      });
      
      const audioStream = ytdl(url, { 
        quality: bestAudioFormat.itag,
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        }
      });
      
      // Promise to handle video download
      const videoPromise = new Promise((resolve, reject) => {
        videoStream.pipe(videoWriteStream);
        videoWriteStream.on('finish', resolve);
        videoWriteStream.on('error', reject);
        videoStream.on('error', reject);
      });
      
      // Promise to handle audio download
      const audioPromise = new Promise((resolve, reject) => {
        audioStream.pipe(audioWriteStream);
        audioWriteStream.on('finish', resolve);
        audioWriteStream.on('error', reject);
        audioStream.on('error', reject);
      });
      
      try {
        // Wait for both streams to finish downloading
        await Promise.all([videoPromise, audioPromise]);
        console.log('Video and audio downloaded successfully, now merging...');
        
        // Create a promise for the ffmpeg process
        const ffmpegPromise = new Promise((resolve, reject) => {
          ffmpeg()
            .input(tempVideoPath)
            .input(tempAudioPath)
            .outputOptions([
              '-map 0:v', // Use video from first input
              '-map 1:a', // Use audio from second input
              '-c:v copy', // Copy video codec (no re-encoding)
              '-c:a aac', // Use AAC audio codec
              '-shortest' // End when shortest input ends
            ])
            .output(outputPath)
            .on('end', () => {
              console.log('FFmpeg processing finished');
              resolve();
            })
            .on('error', (err) => {
              console.error('FFmpeg error:', err);
              reject(err);
            })
            .run();
        });
        
        // Wait for ffmpeg to finish
        await ffmpegPromise;
        
        // Stream the merged file to the client
        const outputStream = fs.createReadStream(outputPath);
        outputStream.pipe(res);
        
        // Clean up temporary files when the response ends
        res.on('finish', () => {
          try {
            fs.unlinkSync(tempVideoPath);
            fs.unlinkSync(tempAudioPath);
            fs.unlinkSync(outputPath);
            console.log('Temporary files cleaned up');
          } catch (err) {
            console.error('Error cleaning up temporary files:', err);
          }
        });
        
      } catch (err) {
        console.error('Error in download and merge process:', err);
        
        // Clean up any temporary files that might have been created
        try {
          if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
          if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (cleanupErr) {
          console.error('Error during cleanup:', cleanupErr);
        }
        
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Failed to merge video and audio', 
            details: err.message 
          });
        }
      }
    }

    // Handle response close/finish
    res.on('finish', () => {
      console.log('Download completed and sent to client');
    });

    res.on('close', () => {
      console.log('Client connection closed');
    });

  } catch (error) {
    console.error('Download error:', error);
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
 * Query params: url (YouTube video URL)
 */
app.get('/formats', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Validate YouTube URL using ytdl-core
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    const videoInfo = await getVideoInfoWithPuppeteer(url);
    res.json(videoInfo);
  } catch (error) {
    console.error('Error getting video info:', error);
    res.status(500).json({ 
      error: 'Failed to fetch video information', 
      details: error.message 
    });
  }
});

/**
 * GET /download - Download video with specified format
 * Query params: url (YouTube video URL), itag (format itag)
 */
app.get('/download', async (req, res) => {
  const { url, itag } = req.query;

  if (!url || !itag) {
    return res.status(400).json({ error: 'URL and itag parameters are required' });
  }

  // Basic YouTube URL validation
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    await downloadVideo(url, itag, res);
  } catch (error) {
    console.error('Error downloading video:', error);
    
    // Check for bot detection
    if (error.message.includes('Sign in to confirm') || error.message.includes('bot')) {
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Failed to download video', 
          details: 'YouTube is blocking this request due to bot detection. Try again later or try a different video.'
        });
      }
    } else if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to download video', 
        details: error.message 
      });
    }
  }
});

/**
 * GET /progress - Get download progress information
 * This is a placeholder endpoint for Vercel deployment
 */
app.get('/progress', (req, res) => {
  // In a serverless environment, we can't track progress between requests
  // This is a placeholder that returns a generic response
  res.json({
    progress: 100,
    status: 'complete'
  });
});

/**
 * GET / - Serve the main HTML page
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', async (req, res) => {
  const ytdlAvailable = await checkYtdlCore();
  res.json({ 
    status: 'OK', 
    ytdl_available: ytdlAvailable,
    message: ytdlAvailable ? 'Ready to download videos' : 'ytdl-core not working properly'
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 YouTube Downloader server running at http://localhost:${PORT}`);
  
  // Check if ytdl-core is available
  const ytdlAvailable = await checkYtdlCore();
  if (ytdlAvailable) {
    console.log('✅ ytdl-core is available and ready');
  } else {
    console.log('❌ ytdl-core may not be working properly');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});