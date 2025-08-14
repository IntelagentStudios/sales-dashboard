import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

// In production, store these in a database
const VALID_LICENSES = [
  { key: 'DEMO-LICENSE-KEY-123', domain: 'demo.com' },
  { key: 'TEST-LICENSE-KEY-456', domain: 'localhost' },
  // Add your actual licenses here or fetch from database
];

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

export async function POST(request: Request) {
  try {
    const { licenseKey, domain } = await request.json();

    if (!licenseKey || !domain) {
      return NextResponse.json(
        { error: 'License key and domain are required' },
        { status: 400 }
      );
    }

    // Clean the domain
    const cleanDomain = domain.toLowerCase().trim();

    // Check if license exists and matches domain
    const validLicense = VALID_LICENSES.find(
      (license) => 
        license.key === licenseKey && 
        (license.domain === cleanDomain || 
         license.domain === 'localhost' || // Allow localhost for development
         cleanDomain.includes(license.domain))
    );

    if (!validLicense) {
      // In production, you'd check against a database here
      // For now, also check environment variables as a fallback
      const envLicenseKey = process.env.LICENSE_KEY;
      const envDomain = process.env.ALLOWED_DOMAIN;
      
      if (envLicenseKey && envDomain) {
        if (licenseKey !== envLicenseKey || !cleanDomain.includes(envDomain)) {
          return NextResponse.json(
            { error: 'Invalid license key or domain' },
            { status: 401 }
          );
        }
      } else if (!validLicense) {
        return NextResponse.json(
          { error: 'Invalid license key or domain' },
          { status: 401 }
        );
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        licenseKey,
        domain: cleanDomain,
        timestamp: Date.now()
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Log successful login (in production, save to database)
    console.log(`Successful login for domain: ${cleanDomain}`);

    return NextResponse.json({
      success: true,
      token,
      domain: cleanDomain,
      message: 'Authentication successful'
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}