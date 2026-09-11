import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = document.getElementById('app');

if (!app) {
  throw new Error('Linkdqueue mount point is missing');
}

mount(App, { target: app });
