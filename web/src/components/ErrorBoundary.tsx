import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/button';

/** A crashing app must not blank the whole desktop: it shows this inside its own window instead. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="grid h-full place-items-center p-4 text-center text-sm">
        <div className="flex max-w-xs flex-col items-center gap-2">
          <p className="font-medium">This app ran into a problem.</p>
          <p className="text-xs text-muted-foreground">{this.state.error.message}</p>
          <Button size="sm" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
