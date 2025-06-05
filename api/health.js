const ytdl = require('@distube/ytdl-core');

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

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const ytdlAvailable = await checkYtdlCore();
  
  res.json({ 
    status: 'OK', 
    ytdl_available: ytdlAvailable,
    message: ytdlAvailable ? 'Ready to download videos' : 'ytdl-core not working properly',
    version: '1.0.0',
    environment: 'Vercel'
  });
}; 