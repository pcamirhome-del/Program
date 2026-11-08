import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  ar: {
    translation: {
      searchPlaceholder: 'ابحث عن برنامج أو لعبة...',
      platforms: { pc: 'كمبيوتر', android: 'أندرويد', ios: 'أيفون' },
      socialApps: 'برامج السوشيال ميديا',
      photoEditors: 'برامج تعديل الصور والفيديو',
      installSelected: 'تسطيب البرامج المحددة أوتوماتيكياً',
      wishlist: 'قائمة الأمنيات',
      devSignature: 'مع تحيات المطور Amir Lamay',
    },
  },
  en: {
    translation: {
      searchPlaceholder: 'Search for an app or game...',
      platforms: { pc: 'PC', android: 'Android', ios: 'iPhone' },
      socialApps: 'Social Media Applications',
      photoEditors: 'Photo & Video Editing Tools',
      installSelected: 'Auto-Install Selected',
      wishlist: 'Wishlist',
      devSignature: 'Developed by Amir Lamay',
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'ar', // اللغة الافتراضية
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
