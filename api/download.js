const ytdl = require('@distube/ytdl-core');

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
  
  const { url, itag } = req.query;
  
  if (!url || !itag) {
    return res.status(400).json({ error: 'URL and itag parameters are required' });
  }
  
  // Validate YouTube URL
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  // Check if we're running in Vercel environment
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  
  try {
    // Get video info to get the title for filename
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/'
        }
      }
    });
    
    const title = info.videoDetails.title
      .replace(/[^\w\s.-]/gi, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length
    
    const filename = `${title}.mp4`;
    
    // Set response headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');
    
    // Get the specific format
    const format = info.formats.find(f => f.itag == itag);
    if (!format) {
      return res.status(400).json({ error: 'Requested format not found' });
    }
    
    // Check if format requires merging and we're in Vercel environment
    if (!format.hasAudio && format.hasVideo && isVercel) {
      return res.status(400).json({ 
        error: 'High-quality format not supported in Vercel deployment',
        details: 'This high-quality format requires merging audio and video streams, which is not supported in our serverless deployment. Please select a format with both audio and video, or use the local version of the app for high-quality downloads.',
        suggestedAction: 'Please select a format with "hasAudio: true" or use our desktop/local version for high-quality downloads.'
      });
    }
    
    // Note: In serverless environment, we can only stream directly
    // No ffmpeg merging is possible in Vercel serverless functions
    const stream = ytdl(url, {
      quality: itag,
      filter: format => format.itag == itag,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/'
        }
      }
    });
    
    // Handle stream errors
    stream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Download failed', 
          details: error.message 
        });
      }
    });
    
    // Pipe the stream to response
    stream.pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Failed to download video', 
        details: error.message 
      });
    }
  }
}; 