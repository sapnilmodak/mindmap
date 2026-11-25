import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// If anything in the interface throws, show what happened and how to recover instead of a blank page. Notes are saved on the server, so reloading loses nothing.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Idea Office crashed:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="io-crash" role="alert">
        <h2>Something went wrong</h2>
        <p>Your notes are safe: everything is saved on the server. Reload to carry on.</p>
        <pre>{this.state.error.message}</pre>
        <button className="io-btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
