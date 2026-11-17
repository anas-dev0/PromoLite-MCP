/** The three non-happy states every view must handle. */
export const LoadingState = ({ label = "Loading…" }: { label?: string }) => (
  <p className="state" role="status">{label}</p>
);
export const EmptyState = ({ label }: { label: string }) => <p className="state">{label}</p>;
export const ErrorState = ({ message }: { message: string }) => (
  <p className="state error" role="alert">{message}</p>
);
