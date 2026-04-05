'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/store';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      router.replace('/home');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen bg-green-50">
      <div className="animate-pulse text-green-700 text-lg font-medium">読み込み中...</div>
    </div>
  );
}
