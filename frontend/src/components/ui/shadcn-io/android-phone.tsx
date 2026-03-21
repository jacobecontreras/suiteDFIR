import { SVGProps, useId } from "react";

export interface AndroidPhoneProps extends SVGProps<SVGSVGElement> {
    width?: number;
    height?: number;
    src?: string;
    videoSrc?: string;
    children?: React.ReactNode;
}

export default function AndroidPhone({
    width = 433,
    height = 882,
    src,
    videoSrc,
    children,
    ...props
}: AndroidPhoneProps) {
    const clipPathId = useId()

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            {/* Outer body */}
            <path
                d="M2 50C2 23.49 23.49 2 50 2H383C409.51 2 431 23.49 431 50V832C431 858.51 409.51 880 383 880H50C23.49 880 2 858.51 2 832V50Z"
                className="fill-[#404040]"
            />
            {/* Inner bezel */}
            <path
                d="M6 50C6 25.6995 25.6995 6 50 6H383C407.301 6 427 25.6995 427 50V832C427 856.301 407.301 876 383 876H50C25.6995 876 6 856.301 6 832V50Z"
                className="fill-[#262626]"
            />
            
            {/* Antenna bands */}
            <rect x="0" y="100" width="4" height="6" fill="#202020" />
            <rect x="429" y="100" width="4" height="6" fill="#202020" />
            <rect x="0" y="780" width="4" height="6" fill="#202020" />
            <rect x="429" y="780" width="4" height="6" fill="#202020" />
            
            {/* Buttons (Right side for volume and power, common on Android) */}
            {/* Volume Buttons */}
            <rect x="431" y="230" width="3" height="90" rx="1.5" className="fill-[#404040]" />
            {/* Power Button */}
            <rect x="431" y="350" width="3" height="50" rx="1.5" className="fill-[#404040]" />

            {/* Default background when no image/video */}
            {!src && !videoSrc && (
                <rect
                    x="16"
                    y="16"
                    width="401"
                    height="850"
                    rx="34"
                    fill="#000000"
                />
            )}

            {src && (
                <image
                    href={src}
                    x="16"
                    y="16"
                    width="401"
                    height="850"
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clipPathId})`}
                />
            )}
            {videoSrc && (
                <foreignObject
                    x="16"
                    y="16"
                    width="401"
                    height="850"
                    clipPath={`url(#${clipPathId})`}
                >
                    <video
                        className="size-full object-cover"
                        src={videoSrc}
                        autoPlay
                        loop
                        muted
                        playsInline
                    />
                </foreignObject>
            )}
            {children && (
                <foreignObject
                    x="16"
                    y="16"
                    width="401"
                    height="850"
                    clipPath={`url(#${clipPathId})`}
                >
                    {children}
                </foreignObject>
            )}

            {/* Hole-punch camera */}
            <circle cx="216.5" cy="45" r="8" className="fill-[#050505]" />
            <circle cx="216.5" cy="45" r="4" className="fill-[#1A1A1A]" />
            <circle cx="216.5" cy="45" r="2" className="fill-[#303030]" />

            <defs>
                <clipPath id={clipPathId}>
                    <rect
                        x="16"
                        y="16"
                        width="401"
                        height="850"
                        rx="34"
                    />
                </clipPath>
            </defs>
        </svg>
    );
}
