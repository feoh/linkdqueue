import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { createBrowserBridge } from '../tests/e2e/mockBridge';

const app = document.getElementById('app');

if (!app) throw new Error('Linkdqueue mount point is missing');

mount(App, { target: app, props: { bridge: createBrowserBridge() } });
