import Iphone15Pro from '@/components/ui/devices/Iphone15Pro';
import AndroidPhone from '@/components/ui/devices/AndroidPhone';

interface PhoneMockupProps {
    type: 'ios' | 'android';
}

export function PhoneMockup({ type }: PhoneMockupProps) {
    return (
        <div className="flex items-center justify-center w-full h-full">
            {type === 'ios' ? (
                <Iphone15Pro className="h-[50vh] max-h-[420px] w-auto drop-shadow-2xl">
                    <div className="h-full w-full flex items-center justify-center bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/apple-logo.svg"
                            alt="iOS"
                            className="w-24 h-24 opacity-80"
                            style={{ filter: 'invert(1)' }}
                        />
                    </div>
                </Iphone15Pro>
            ) : (
                <AndroidPhone className="h-[50vh] max-h-[420px] w-auto drop-shadow-2xl">
                    <div className="h-full w-full flex items-center justify-center bg-black">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/android-logo.svg"
                            alt="Android"
                            className="w-20 h-20 opacity-80"
                            style={{ filter: 'invert(1)' }}
                        />
                    </div>
                </AndroidPhone>
            )}
        </div>
    );
}
