export function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Mungon ${name}.`);
	}
	return value;
}

export function optionalEnv(name: string): string | null {
	return process.env[name]?.trim() || null;
}
