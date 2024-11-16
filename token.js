import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { randomBytes } from 'crypto';
import dotenv from "dotenv";

dotenv.config();

// 配置常量
const CONFIG = {
  API_BASE: process.env.COZE_API_BASE || "api.coze.com",
  PRIVATE_KEY: process.env.BOT_PRIVATE_KEY || "",
  JWT_CONFIG: process.env.BOT_JWT_CONFIG ? JSON.parse(process.env.BOT_JWT_CONFIG) : {},
  TOKEN_DURATION: 86399, // 24小时
  JWT_EXPIRY: 15 * 60  // 15分钟
};

// JWT token生成函数
function generateJWTToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CONFIG.JWT_CONFIG.iss,
    aud: CONFIG.JWT_CONFIG.aud,
    iat: now,
    exp: now + CONFIG.JWT_EXPIRY,
    jti: randomBytes(16).toString('hex')
  };

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: CONFIG.JWT_CONFIG.kid
  };

  return jwt.sign(payload, CONFIG.PRIVATE_KEY, { 
    algorithm: 'RS256',
    header 
  });
}

async function getAccessToken() {
  try {
    const jwtToken = generateJWTToken();
    const response = await fetch(`https://${CONFIG.API_BASE}/api/permission/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        duration_seconds: CONFIG.TOKEN_DURATION,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.access_token) {
      throw new Error('No access token received');
    }

    return {
      access_token: data.access_token,
      expires_in: data.expires_in
    };

  } catch (error) {
    console.error('Failed to get access token:', error.message);
    throw error;
  }
}

export default getAccessToken;