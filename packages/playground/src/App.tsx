import './App.css';

import React, { useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Logo from "./favicon.svg";

import { Home } from './sections/Home';
import { Playground } from './sections/Playground';
import { DarkModeToggle } from "./components/DarkModeToggle";

const routes = [
  {
    path: "/",
    component: <Playground />
  },
  // {
  //   path: "/welcome",
  //   component: <Home />
  // },
];

export default function App() {
  return (
    <div className="flex h-screen bg-gray-100 font-roboto">

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <img src={Logo} alt="" className="w-8 mr-2" />
              <h1 className="text-2xl dark:text-slate-300">
                <span className="font-semibold">Colyseus</span>{' '}
                <span className="font-extralight">Playground</span>
              </h1>
            </div>
            <DarkModeToggle />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-slate-800">
          <Routes>
            {routes.map((route, index) => (
              <Route
                key={index}
                path={route.path}
                element={route.component}
              />
            ))}
          </Routes>
        </div>

        {/* Footer */}
        <div className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700 px-8 py-3">
          <p className="text-center text-gray-600 text-xs font-light dark:text-slate-400">
            <p className="mb-1">Colyseus is free and open-source. Your support helps keep it independent and thriving!</p>

            <a href="https://github.com/sponsors/endel" className="text-purple-700 hover:text-purple-500 dark:text-purple-400" target="_blank"> ❤️ Become a sponsor </a>
            &nbsp;|&nbsp;
            <a
              href="https://github.com/colyseus/colyseus"
              target="_blank"
              className="text-purple-700 hover:text-purple-500 dark:text-purple-400"
              rel="noopener noreferrer"
            >
              ⭐ Give it a star on GitHub
            </a>
          </p>
        </div>

      </div>

    </div>
  );
};
