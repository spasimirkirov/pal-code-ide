import path from 'node:path';

export const getRuntimePaths = (electronApp) => {
    const palRoot = electronApp.getPath('userData');
    const llamaServerDir = path.join(palRoot, 'llama-server');
    const modelsDir = path.join(palRoot, 'models');
    const tempDir = path.join(palRoot, 'temp');

    return {
        palRoot,
        llamaServerDir,
        modelsDir,
        tempDir,
        llamaExe: path.join(llamaServerDir, 'llama-server.exe'),
        coderModel: path.join(modelsDir, 'Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf'),
        visionModel: path.join(modelsDir, 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf'),
    };
};
