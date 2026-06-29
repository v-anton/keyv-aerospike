export type ParsedConnection = {
	hosts: Array<{ addr: string; port: number }>;
	user?: string;
	password?: string;
	set?: string;
	aerospikeNamespace?: string;
};

const DEFAULT_PORT = 3000;

export function parseConnectionString(connect: string): ParsedConnection {
	const withoutScheme = connect.replace(/^aerospike:\/\//, "");
	const [authority, query] = withoutScheme.split("?", 2);

	let credentials: string | undefined;
	let hostList = authority;
	const atIndex = authority.lastIndexOf("@");
	if (atIndex !== -1) {
		credentials = authority.slice(0, atIndex);
		hostList = authority.slice(atIndex + 1);
	}

	const hosts = hostList
		.split(",")
		.filter(Boolean)
		.map((entry) => {
			const [addr, port] = entry.split(":", 2);
			return { addr, port: port ? Number.parseInt(port, 10) : DEFAULT_PORT };
		});

	const result: ParsedConnection = { hosts };

	if (credentials) {
		const [user, password] = credentials.split(":", 2);
		result.user = user;
		if (password !== undefined) {
			result.password = password;
		}
	}

	if (query) {
		const params = new URLSearchParams(query);
		const set = params.get("set");
		const namespace = params.get("namespace");
		if (set) {
			result.set = set;
		}
		if (namespace) {
			result.aerospikeNamespace = namespace;
		}
	}

	return result;
}
