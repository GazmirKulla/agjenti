import { fileURLToPath } from 'node:url';
const config = {
 root: fileURLToPath(new URL('../',import.meta.url)),
 css:{postcss:{plugins:[]}},
 test:{environment:'node',include:['e2e/semantic-model.test.ts'],testTimeout:45000},
 resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},
};

export default config;
