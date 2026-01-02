// /api/store_orders.js na Vercel
import { promises as fs } from 'fs';
import path from 'path';

// Ulož dátový súbor
const DATA_FILE = '/tmp/orders_data.json';

export default async function handler(req, res) {
  // Povoliť CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { user, orders, timestamp } = req.body;
    
    console.log(`[STORE] Storing ${orders?.length || 0} orders for user ${user}`);
    
    // Načítaj existujúce dáta
    let allData = {};
    try {
      const existingData = await fs.readFile(DATA_FILE, 'utf8');
      allData = JSON.parse(existingData);
    } catch (e) {
      // Súbor neexistuje
    }
    
    // Ulož nové dáta
    allData[user] = {
      orders: orders || [],
      updated: timestamp || Date.now(),
      user: user
    };
    
    // Zapíš do súboru
    await fs.writeFile(DATA_FILE, JSON.stringify(allData, null, 2));
    
    console.log(`[STORE] Successfully stored data for ${user}`);
    
    return res.status(200).json({
      success: true,
      message: `Stored ${orders?.length || 0} orders for ${user}`,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('[STORE ERROR]', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}