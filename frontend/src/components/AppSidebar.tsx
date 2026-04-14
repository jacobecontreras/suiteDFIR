import {
    LayoutDashboard,
    Smartphone,
    Box,
    PanelLeft,
    Archive,
    ChevronLeft,
    Database
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
    SidebarSeparator,
    useSidebar,
} from "@/components/ui/Sidebar"

import { useState, useEffect } from "react"
import { useLocation, useNavigate, Link } from "react-router-dom"
import { useCase } from "@/context/CaseContext"

// Menu items.
const data = {
    case: [
        {
            title: "Dashboard",
            url: "/dashboard",
            icon: LayoutDashboard,
        },
        {
            title: "Library",
            url: "/library",
            icon: Archive,
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
            title: "Database",
            url: "/db-viewer",
            icon: Database,
        },
    ],
}

export function AppSidebar() {
    const { toggleSidebar } = useSidebar()
    const { selectedCaseId, cases } = useCase()
    const location = useLocation()
    const pathname = location.pathname
    const search = location.search
    const navigate = useNavigate()

    const currentCase = cases.find(c => c.id.toString() === selectedCaseId)

    const { state } = useSidebar()
    const [isHeaderVisible, setIsHeaderVisible] = useState(state === "expanded")
    const [isBackVisible, setIsBackVisible] = useState(state === "collapsed")

    useEffect(() => {
        if (state === "expanded") {
            setIsBackVisible(false)
            const timer = setTimeout(() => setIsHeaderVisible(true), 200)
            return () => clearTimeout(timer)
        } else {
            setIsHeaderVisible(false)
            setIsBackVisible(true)  // Instant, no delay
        }
    }, [state])

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader className="pt-4 px-2 group-data-[state=collapsed]:px-0">
                {currentCase && (
                    <div className="flex flex-col relative min-h-[50px] mb-4">
                        <div className={`px-4 flex flex-col gap-1.5 transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100 pointer-events-auto' : 'duration-0 opacity-0 pointer-events-none'}`}>
                            <div className="font-['Oswald'] text-xl font-bold tracking-wide text-gray-200">
                                suiteDFIR
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-400 truncate max-w-[120px]" title={currentCase.name}>
                                    {currentCase.name}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#1A1A1A] text-gray-400 border border-[#333333] whitespace-nowrap">
                                    {currentCase.status}
                                </span>
                            </div>
                        </div>

                        <div className={`absolute top-0 left-0 right-0 h-[50px] flex items-center justify-center ${isBackVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                            <SidebarMenuButton
                                tooltip="Back to Cases"
                                onClick={() => navigate('/cases')}
                                className="h-10 w-10 hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/70"
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </SidebarMenuButton>
                        </div>

                        <div
                            aria-hidden="true"
                            className={`mt-4 -mx-2 -mr-[calc(0.5rem+1px)] h-px bg-[#222222] transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}
                        />
                    </div>
                )}
                <SidebarGroup>
                    <SidebarGroupLabel className={`text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wider transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}>Case</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {data.case.map((item) => {
                                // For Library, highlight for all /library/* paths
                                const isActive = item.url === '/library'
                                    ? pathname.startsWith('/library')
                                    : pathname === item.url;

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                                            <Link to={item.url}>
                                                <item.icon />
                                                <span className={`text-[11px] uppercase tracking-wider font-medium transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel className={`text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wider transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}>Mobile Tools</SidebarGroupLabel>
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
                                                <span className={`text-[11px] uppercase tracking-wider font-medium transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <SidebarGroup>
                    <SidebarGroupLabel className={`text-[10px] font-medium text-sidebar-foreground/70 uppercase tracking-wider transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}>Data Analysis</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {data.data_analysis.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild tooltip={item.title} isActive={pathname === item.url}>
                                        <Link to={item.url}>
                                            <item.icon />
                                            <span className={`text-[11px] uppercase tracking-wider font-medium transition-opacity ${isHeaderVisible ? 'duration-150 opacity-100' : 'duration-0 opacity-0'}`}>{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarHeader>

            <SidebarContent />

            <SidebarSeparator className="bg-[#222222] w-[85%] !mx-auto my-0 hidden group-data-[state=expanded]:block" />

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
