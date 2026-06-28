import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users as UsersIcon,
  CreditCard,
  FolderTree,
  MapPin,
  ShieldCheck,
  ScrollText,
  User as UserIcon,
  LogOut,
  Info,
  BookOpen,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/hooks/use-auth-user";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Contatti", url: "/contacts", icon: UsersIcon },
  { title: "Tesseramenti", url: "/subscriptions", icon: CreditCard },
  { title: "Gruppi", url: "/groups", icon: FolderTree },
  { title: "Città", url: "/cities", icon: MapPin },
];

const adminItems = [
  { title: "Utenti", url: "/users", icon: ShieldCheck, minRole: ["admin", "superuser", "coordinator"] },
  { title: "Audit Log", url: "/audit", icon: ScrollText, minRole: ["admin"] },
];

function OltremaniArc({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * 0.58)}
      viewBox="0 0 48 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M0 28 C0 12.536 10.745 0 24 0 C37.255 0 48 12.536 48 28 L36 28 C36 19.163 30.627 12 24 12 C17.373 12 12 19.163 12 28 Z"
        fill="#E8921E"
      />
    </svg>
  );
}


export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile } = useAuthUser();
  const navigate = useNavigate();

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-3 py-3">
          {!collapsed ? (
            <img
              src="/logo-white.png"
              alt="Oltremani"
              className="h-7 w-auto object-contain object-left"
            />
          ) : (
            <div className="flex justify-center py-1">
              <OltremaniArc size={28} />
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operatività</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {profile && (
          <SidebarGroup>
            <SidebarGroupLabel>Amministrazione</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems
                  .filter((it) => it.minRole.includes(profile.role))
                  .map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/profile")}>
              <Link to="/profile" className="flex items-center gap-2">
                <UserIcon className="h-4 w-4" />
                {!collapsed && <span>Profilo</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/app")}>
              <Link to="/app" className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                {!collapsed && <span>App</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/guida")}>
              <Link to="/guida" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {!collapsed && <span>Guida</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="w-full justify-start gap-2 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Esci</span>}
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
