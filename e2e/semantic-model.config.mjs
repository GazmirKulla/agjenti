import { fileURLToPath } from 'node:url';
const config = {
 root: fileURLToPath(new URL('../',import.meta.url)),
 css:{postcss:{plugins:[]}},
 test:{environment:'node',include:['e2e/semantic-model.test.ts','e2e/workflow-authoring-model.test.ts','e2e/configuration-model.test.ts'],testTimeout:90000},
 resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},
};

export default config;
