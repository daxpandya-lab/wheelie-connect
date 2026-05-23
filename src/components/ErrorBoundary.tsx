import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode; fallbackTitle?: string }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
          <h2 className="font-semibold text-foreground">{this.props.fallbackTitle ?? "Something went wrong"}</h2>
          <p className="text-sm text-muted-foreground break-words">{this.state.error.message}</p>
          <Button size="sm" variant="outline" onClick={this.reset}>Try again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
