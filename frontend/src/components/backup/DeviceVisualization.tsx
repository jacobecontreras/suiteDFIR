import { ReactNode } from 'react'
import Iphone15Pro from "@/components/ui/shadcn-io/iphone-15-pro"
import AndroidPhone from "@/components/ui/shadcn-io/android-phone"
import { cn } from "@/lib/utils"

interface DeviceVisualizationProps {
    type: 'ios' | 'android'
    isConnected: boolean
    encryptionControl?: ReactNode
}

export function DeviceVisualization({
    type,
    isConnected,
    encryptionControl
}: DeviceVisualizationProps) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center relative min-h-0">
            {/* Glow effect behind device (always visible but subtle) */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-3xl transition-all duration-700 ${isConnected ? 'bg-blue-500/10 opacity-50' : 'bg-gray-500/5 opacity-30'}`} />

            <div className="relative translate-y-8 transform transition-transform duration-700 hover:translate-y-8 hover:scale-[1.02]">
                {type === 'ios' ? (
                    <Iphone15Pro className="h-[378px] w-auto drop-shadow-2xl">
                        {!isConnected && (
                            <div className="h-full w-full flex flex-col items-center justify-center bg-[#050505] text-gray-500 space-y-4">
                                <p className="text-2xl font-light tracking-wide text-gray-400">Not Connected</p>
                            </div>
                        )}
                        {isConnected && (
                            <div className="h-full w-full bg-black flex flex-col px-8 py-8">
                                <div className="flex-1 flex items-center justify-center">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="/apple-logo.svg"
                                        alt="Connected"
                                        className="w-28 h-28 opacity-80"
                                        style={{ filter: 'invert(1)' }}
                                    />
                                </div>
                            </div>
                        )}
                    </Iphone15Pro>
                ) : (
                    <AndroidPhone className="h-[378px] w-auto drop-shadow-2xl">
                        {!isConnected && (
                            <div className="h-full w-full flex flex-col items-center justify-center bg-[#050505] text-gray-500 space-y-4">
                                <p className="text-2xl font-light tracking-wide text-gray-400">Not Connected</p>
                            </div>
                        )}
                        {isConnected && (
                            <div className="h-full w-full bg-black flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src="/android-logo.svg"
                                    alt="Connected"
                                    className="w-24 h-24 opacity-80"
                                    style={{ filter: 'invert(1)' }}
                                />
                            </div>
                        )}
                    </AndroidPhone>
                )}
            </div>

            {/* iOS Encrypt Backup - positioned below phone */}
            {encryptionControl && (
                <div className="absolute top-[calc(50%+230px)] left-1/2 -translate-x-1/2 text-white">
                    {encryptionControl}
                </div>
            )}
        </div>
    )
}
