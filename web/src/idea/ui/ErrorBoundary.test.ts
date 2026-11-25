import { describe, expect, it } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

// No browser here, so these check the boundary's own logic: it catches the error and renders the recovery screen.
describe('ErrorBoundary', () => {
  it('turns a thrown error into state', () => {
    const e = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(e)).toEqual({ error: e });
  });
  it('renders its children when nothing went wrong', () => {
    const child = { marker: 'app' } as unknown as React.ReactNode;
    const b = new ErrorBoundary({ children: child });
    expect(b.render()).toBe(child);
  });
  it('renders an alert with the message and a reload button after an error', () => {
    const b = new ErrorBoundary({ children: null });
    b.state = { error: new Error('graphics exploded') };
    const el = b.render() as unknown as { props: { role: string; className: string; children: any[] } };
    expect(el.props.role).toBe('alert');
    const text = JSON.stringify(el.props.children);
    expect(text).toMatch(/Something went wrong/);
    expect(text).toMatch(/graphics exploded/);
    expect(text).toMatch(/notes are safe/i);
    expect(text).toMatch(/Reload/);
  });
});
