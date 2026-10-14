import { execa } from 'execa';
export async function getOutdated(dir, pm) {
    try {
        const { stdout } = await execa(pm, ['outdated', '--json'], {
            cwd: dir,
            reject: false,
        });
        if (!stdout.trim())
            return [];
        const raw = JSON.parse(stdout);
        return Object.entries(raw).map(([name, v]) => ({
            name,
            current: v.current,
            wanted: v.wanted,
            latest: v.latest,
            type: v.type ?? 'dependencies',
        }));
    }
    catch {
        return [];
    }
}
// выбираем пакет с мажорным апдейтом — самый "страшный" случай
export function pickTarget(pkgs) {
    const major = pkgs.filter((p) => {
        const [c] = p.current.replace(/^[^\d]*/, '').split('.');
        const [l] = p.latest.replace(/^[^\d]*/, '').split('.');
        return c !== l;
    });
    return major[0] ?? pkgs[0] ?? null;
}
