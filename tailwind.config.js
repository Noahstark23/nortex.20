/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./app/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            colors: {
                nortex: {
                    900: '#0f172a', // Slate 900
                    800: '#1e293b', // Slate 800
                    500: '#3b82f6', // Blue 500
                    400: '#60a5fa', // Blue 400
                    accent: '#10b981', // Emerald 500
                    danger: '#ef4444',
                    warning: '#f59e0b',
                }
            }
        },
    },
    plugins: [],
}
