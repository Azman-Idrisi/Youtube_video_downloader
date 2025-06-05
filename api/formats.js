const ytdl = require('@distube/ytdl-core');

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

    // Enhanced headers for better compatibility in serverless environments
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
    throw new Error('Failed to extract video information. Please try a different video or a simpler URL.');
  }
}

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }
  
  // Validate YouTube URL
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  try {
    const videoInfo = await getVideoInfo(url);
    return res.status(200).json(videoInfo);
  } catch (error) {
    console.error('Error getting video info:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch video information', 
      details: error.message 
    });
  }
}; 