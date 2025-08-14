import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export const authentication = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      const apiKey = req.headers['x-api-key'];
      
      if (apiKey) {
        const validKey = await validateApiKey(apiKey);
        if (validKey) {
          req.auth = { type: 'api_key', ...validKey };
          return next();
        }
      }
      
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.auth = { type: 'jwt', ...decoded };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    next(error);
  }
};

export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

export const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

const validateApiKey = async (apiKey) => {
  const hashedKey = await hashApiKey(apiKey);
  
  const result = await query(
    'SELECT * FROM api_keys WHERE key_hash = $1 AND active = true',
    [hashedKey]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  await query(
    'UPDATE api_keys SET last_used = NOW(), usage_count = usage_count + 1 WHERE id = $1',
    [result.rows[0].id]
  );
  
  return result.rows[0];
};

const hashApiKey = async (key) => {
  const crypto = await import('crypto');
  return crypto.default.createHash('sha256').update(key).digest('hex');
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};