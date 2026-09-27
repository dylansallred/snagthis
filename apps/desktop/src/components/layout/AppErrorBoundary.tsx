import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ui } from '@/lib/strings';

// URLs can carry sign-in, query tokens or private media hosts; keep only scheme, host and path.
export function redactErrorDetails(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#)]*)[?#][^\s)]*/gi, '$1')
    .replace(/\b(bearer)\s+[^\s,;)]+/gi, '$1 [redacted]')
    .replace(/\b(token|authorization|password|secret|api[-_]?key)(\s*[=:]\s*)[^\s,;)]+/gi, '$1$2[redacted]');
}

/** The whole-window fallback: a render error must never leave the window blank or immovable. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; details: string; copied: boolean }> {
  state = { error: null as Error | null, details: '', copied: false };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const details = redactErrorDetails([`${failure.name}: ${failure.message}`, failure.stack, info.componentStack].filter(Boolean).join('\n'));
    this.setState({ details });
    // There is no renderer log channel to the main process; the console reaches DevTools and Electron's logs.
    console.error('SnagThis could not render', details);
  }

  copy = () => {
    const { details, error } = this.state;
    navigator.clipboard?.writeText(details || redactErrorDetails(String(error))).then(() => this.setState({ copied: true }), () => {});
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <div className="workbench app-error" role="alert">
      <header className="top-bar drag-region" />
      <div className="first-download">
        <h2>{ui.renderFailed}</h2>
        <p>{ui.renderFailedBody}</p>
        <button className="row-action primary-action no-drag" onClick={() => window.location.reload()}>{ui.reload}</button>
        <button className="text-link no-drag" onClick={this.copy}>{this.state.copied ? ui.copied : ui.copyDetails}</button>
      </div>
    </div>;
  }
}
