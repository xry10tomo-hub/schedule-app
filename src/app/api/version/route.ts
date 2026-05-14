import { NextResponse } from 'next/server';

// Returns the current build version for client-side update detection
// Set at build time via next.config.ts → env.NEXT_PUBLIC_BUILD_VERSION
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const version = process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown';
  return NextResponse.json(
    { version, timestamp: Date.now() },
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  );
}
