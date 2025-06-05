const fs = require('fs');
const path = require('path');

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
  
  try {
    // Read the index.html file
    const filePath = path.join(__dirname, '..', 'index.html');
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Set content type
    res.setHeader('Content-Type', 'text/html');
    
    // Send the HTML content
    res.status(200).send(content);
  } catch (error) {
    console.error('Error serving index.html:', error);
    res.status(500).send('Error loading the application');
  }
}; 