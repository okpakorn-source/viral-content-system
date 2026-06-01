import { NextResponse } from 'next/server';
import { login, logout, getSession, register } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(request) {
  try {
    const { action, username, password, displayName, role, avatar } = await request.json();

    if (action === 'login') {
      const result = await login(username, password);
      if (!result.success) return NextResponse.json(result, { status: 401 });

      // Set cookie on response
      const response = NextResponse.json(result);
      response.cookies.set('auth_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      });
      return response;
    }

    if (action === 'logout') {
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      if (token) await logout(token);
      const response = NextResponse.json({ success: true });
      response.cookies.set('auth_token', '', { maxAge: 0, path: '/' });
      return response;
    }

    if (action === 'register') {
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      const session = await getSession(token);
      if (!session || session.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'ไม่มีสิทธิ์' }, { status: 403 });
      }
      const result = await register({ username, password, displayName, role, avatar });
      return NextResponse.json(result);
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[Auth] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    if (!token) {
      return NextResponse.json({ success: true, loggedIn: false });
    }

    const session = await getSession(token);
    if (!session) {
      return NextResponse.json({ success: true, loggedIn: false });
    }

    return NextResponse.json({
      success: true,
      loggedIn: true,
      member: {
        id: session.memberId,
        username: session.username,
        displayName: session.displayName,
        role: session.role,
        avatar: session.avatar,
      },
    });
  } catch (error) {
    console.error('[Auth GET] Error:', error.message);
    // Don't block on auth errors - just return not logged in
    return NextResponse.json({ success: true, loggedIn: false });
  }
}
