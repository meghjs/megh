import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import Announcement from './Announcement.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'layout-top': () => h(Announcement) }),
};
