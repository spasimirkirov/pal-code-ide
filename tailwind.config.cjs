/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    theme: {
        extend: {
            colors: {
                panel: '#0a111f',
                panelSoft: '#111a2d',
                edge: '#1f2d47',
                accent: '#2bd1ff',
                accentWarm: '#ffd166',
            },
            boxShadow: {
                glow: '0 0 0 1px rgba(43, 209, 255, 0.18), 0 22px 60px rgba(0, 0, 0, 0.45)',
            },
        },
    },
    plugins: [],
};
