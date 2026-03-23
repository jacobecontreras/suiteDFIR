import {
    LayoutDashboard,
    FileText,
    Smartphone,
    Box,
    Clock,
    PanelLeft,
    Archive,
    ChevronLeft
} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar"

import { useLocation, useNavigate, Link } from "react-router-dom"

// Menu items.
const data = {
    case: [
        {
            title: "Dashboard",
            url: "/dashboard",
            icon: LayoutDashboard,
        },
        {
            title: "Reports",
            url: "/reports",
            icon: FileText,
        },
    ],
    mobile_tools: [
        {
            title: "Analysis",
            url: "/analysis?tool=ileapp",
            icon: Smartphone,
        },
        {
            title: "Extraction",
            url: "/extraction?type=ios",
            icon: Archive,
        },
    ],

    data_analysis: [
        {
            title: "GeoSpatial",
            url: "/spatial",
            icon: Box,
        },
        {
            title: "Timeline",
            url: "/timeline",
            icon: Clock,
        },
    ],
}

export function AppSidebar() {
    const { toggleSidebar } = useSidebar()
    const location = useLocation()
    const pathname = location.pathname
    const search = location.search
    const navigate = useNavigate()

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader className="pt-4 px-2 group-data-[state=collapsed]:px-0">
                <SidebarGroup>
                    <SidebarGroupLabel className="text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wider">Case</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {data.case.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild tooltip={item.title} isActive={pathname === item.url}>
                                        <Link to={item.url}>
                                            <item.icon />
                                            <span className="text-[11px] uppercase tracking-wider font-medium">{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel className="text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wider">Mobile Tools</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {data.mobile_tools.map((item) => {
                                const isActive =
                                    item.url.startsWith('/analysis') ? pathname === '/analysis'
                                        : item.url.startsWith('/extraction') ? pathname === '/extraction'
                                            : pathname === item.url && search === ''

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                                            <Link to={item.url}>
                                                <item.icon />
                                                <span className="text-[11px] uppercase tracking-wider font-medium">{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel className="text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wider">Data Analysis</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {data.data_analysis.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild tooltip={item.title} isActive={pathname === item.url}>
                                        <Link to={item.url}>
                                            <item.icon />
                                            <span className="text-[11px] uppercase tracking-wider font-medium">{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarHeader>

            <SidebarContent />

            <SidebarFooter>
                <SidebarMenu>
                    <SidebarMenuItem className="flex items-center gap-1 group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:px-0">
                        <SidebarMenuButton
                            tooltip="Back to Cases"
                            onClick={() => navigate('/cases')}
                            className="h-10 flex-1 hover:bg-sidebar-accent p-0 flex items-center justify-center group-data-[state=collapsed]:hidden"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </SidebarMenuButton>
                        <SidebarMenuButton
                            tooltip="Toggle Sidebar"
                            onClick={toggleSidebar}
                            className="h-10 flex-1 hover:bg-sidebar-accent p-0 flex items-center justify-center group-data-[state=collapsed]:h-10 group-data-[state=collapsed]:w-10"
                        >
                            <PanelLeft className="h-5 w-5" />
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>

        </Sidebar>
    )
}
