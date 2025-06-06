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

// Vercel serverless environment detection
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

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
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Referer': 'https://www.google.com/',
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
    
    // Skip Puppeteer in Vercel environment due to limitations
    if (isVercel) {
      console.log('Running in Vercel environment, skipping Puppeteer fallback');
      throw new Error('Cannot use Puppeteer in serverless environment. Try a different video or use a simpler URL.');
    }
    
    // Helper function for random delays to mimic human behavior
    const randomDelay = async (min, max) => {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      return new Promise(resolve => setTimeout(resolve, delay));
    };
    
    // Launch browser with enhanced stealth options
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent to a common configuration
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    // Add extra headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });
    
    // Add human-like browser fingerprinting evasion
    await page.evaluateOnNewDocument(() => {
      // Override navigator properties to avoid detection
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5].map(() => ({ length: 0 })) });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      
      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Add fake WebGL vendor and renderer
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.apply(this, arguments);
      };
    });
    
    // Navigate to the video page with increased timeout
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for title to be available
    await page.waitForSelector('title', { timeout: 5000 });
    
    // Perform random human-like interactions
    await randomDelay(1000, 3000);
    
    // Simulate scrolling like a human would
    await page.evaluate(() => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const distance = Math.floor(Math.random() * 100) + 50;
        const scrollInterval = Math.floor(Math.random() * 200) + 100;
        
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          
          if (totalHeight >= 800) {
            clearInterval(timer);
            resolve();
          }
        }, scrollInterval);
      });
    });
    
    await randomDelay(500, 2000);
    
    // Extract video information
    const videoInfo = await page.evaluate(() => {
      // Check if video is available
      if (document.querySelector('.promo-title')) {
        const promoText = document.querySelector('.promo-title').innerText;
        if (promoText.includes('unavailable')) {
          throw new Error('Video unavailable');
        }
      }
      
      // Get video title
      const title = document.querySelector('meta[property="og:title"]')?.content || 
                    document.querySelector('title')?.innerText?.replace(' - YouTube', '') || 
                    'Unknown Title';
      
      // Get channel name
      const channelName = document.querySelector('link[itemprop="name"]')?.content || 
                          document.querySelector('[itemprop="author"] [itemprop="name"]')?.content || 
                          'Unknown Channel';
      
      // Get thumbnail
      const thumbnail = document.querySelector('meta[property="og:image"]')?.content || '';
      
      // Get video duration (in seconds)
      let duration = 0;
      const durationMeta = document.querySelector('meta[itemprop="duration"]')?.content;
      if (durationMeta) {
        // Parse ISO 8601 duration format (PT1H2M3S)
        const match = durationMeta.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
          const hours = parseInt(match[1] || 0);
          const minutes = parseInt(match[2] || 0);
          const seconds = parseInt(match[3] || 0);
          duration = hours * 3600 + minutes * 60 + seconds;
        }
      }
      
      return {
        title,
        channelName,
        thumbnail,
        duration
      };
    });
    
    console.log('Video title:', videoInfo.title);
    
    // Extract cookies from the page to use with ytdl-core
    const cookies = await page.cookies();
    const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    
    console.log('Extracted cookies from authenticated session');
    
    // Now extract available formats using ytdl-core with the cookies
    try {
      // Wait a bit before making the ytdl request
      await randomDelay(1000, 2000);
      
      const info = await ytdl.getInfo(url, {
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Referer': 'https://www.google.com/',
            'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'Cookie': cookieString
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
        duration: videoInfo.duration || parseInt(info.videoDetails.lengthSeconds),
        thumbnail: videoInfo.thumbnail,
        uploader: videoInfo.channelName,
        formats: uniqueFormats
      };
    } catch (ytdlError) {
      console.error('ytdl-core error:', ytdlError.message);
      
      // If ytdl-core fails, return basic info without formats
      return {
        title: videoInfo.title,
        duration: videoInfo.duration,
        thumbnail: videoInfo.thumbnail,
        uploader: videoInfo.channelName,
        formats: [],
        error: 'Could not retrieve formats: ' + ytdlError.message
      };
    }
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

    // Enhanced headers for better compatibility, especially in serverless environments
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Referer': 'https://www.google.com/',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    // Multiple retries for Vercel environment
    let retries = 0;
    const maxRetries = 3;
    let lastError = null;

    while (retries < maxRetries) {
      try {
        console.log(`Attempt ${retries + 1} to fetch video info`);
        
        // Get video info with additional options for better compatibility
        const info = await ytdl.getInfo(url, {
          requestOptions: { headers }
        });
        
        const videoDetails = info.videoDetails;
        console.log('Successfully retrieved info with ytdl-core');
        
        // Filter formats
        let availableFormats = info.formats.filter(format => {
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
        lastError = error;
        console.error(`Attempt ${retries + 1} failed:`, error.message);
        retries++;
        
        // Wait before retry (exponential backoff)
        if (retries < maxRetries) {
          const delay = Math.pow(2, retries) * 1000;
          console.log(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If we've exhausted all retries, throw the last error
    throw lastError || new Error('Failed to fetch video info after multiple attempts');
  } catch (error) {
    console.error('Error in getVideoInfo:', error.message);
    
    // Provide more specific error messages for Vercel environment
    if (isVercel) {
      console.log('Error in Vercel environment, providing simplified error message');
      throw new Error('Failed to extract video information. Please try a different video or a simpler URL.');
    }
    
    // Provide more specific error messages for non-Vercel environments
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

  console.log('Received request for formats with URL:', url);

  if (!url) {
    console.log('URL parameter is missing');
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Validate YouTube URL using ytdl-core
  if (!ytdl.validateURL(url)) {
    console.log('Invalid YouTube URL:', url);
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    console.log('URL is valid, attempting to get video info');
    // In Vercel environment, skip Puppeteer and use only ytdl-core
    if (isVercel) {
      console.log('Running in Vercel environment, using getVideoInfo instead of Puppeteer');
      const videoInfo = await getVideoInfo(url);
      console.log('Successfully retrieved video info with getVideoInfo');
      return res.json(videoInfo);
    } else {
      console.log('Using getVideoInfoWithPuppeteer for local environment');
      const videoInfo = await getVideoInfoWithPuppeteer(url);
      console.log('Successfully retrieved video info with Puppeteer');
      return res.json(videoInfo);
    }
  } catch (error) {
    console.error('Error getting video info:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch video information', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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