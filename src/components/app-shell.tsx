import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { useAuthUser } from "@/hooks/use-auth-user";

const ROLE_LABEL: Record<string, string> = {
  admin: "Amministratore",
  superuser: "Superuser",
  coordinator: "Coordinatore",
  volunteer: "Volontario",
};

export function AppShell({ children, title, subtitle, actions }: { children: ReactNode; title?: string; subtitle?: string; actions?: ReactNode }) {
  const { profile } = useAuthUser();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border bg-card/60 backdrop-blur px-3 md:px-6 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              {title && <h1 className="text-base md:text-lg font-serif font-semibold">{title}</h1>}
            </div>
            <div className="flex items-center gap-3 text-sm">
              {profile && (
                <div className="text-right hidden sm:block">
                  <div className="font-medium leading-tight">{profile.name}</div>
                  <div className="text-xs text-muted-foreground">{ROLE_LABEL[profile.role] ?? profile.role}</div>
                </div>
              )}
              <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                {(profile?.name ?? "?").charAt(0).toUpperCase()}
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-8">
            {(subtitle || actions) && (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
                {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
                {actions && <div>{actions}</div>}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
