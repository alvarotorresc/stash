import { mount } from 'svelte';
import '../src/styles.css';
import Catalog from './Catalog.svelte';

const target = document.getElementById('app');
if (target) mount(Catalog, { target });
