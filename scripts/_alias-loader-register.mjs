import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./_alias-loader.mjs', pathToFileURL('./scripts/'));
