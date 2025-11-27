import './App.css';

import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Logo from "./favicon.svg";

import { Playground } from './sections/Playground';
import { DarkModeToggle } from "./components/DarkModeToggle";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faTimes } from "@fortawesome/free-solid-svg-icons";

export default function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-100 font-roboto">

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700 px-4 md:px-8 py-3 md:py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center min-w-0 gap-3">
              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden text-gray-700 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex-shrink-0"
                aria-label="Toggle menu"
              >
                <FontAwesomeIcon icon={isMobileMenuOpen ? faTimes : faBars} size="lg" />
              </button>

              <img src={Logo} alt="" className="w-6 md:w-8 flex-shrink-0" />
              <h1 className="text-lg md:text-2xl dark:text-slate-300 truncate">
                <span className="font-semibold">Colyseus</span>{' '}
                <span className="font-extralight sm:inline">Playground</span>
              </h1>
            </div>
            <DarkModeToggle />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-slate-800">
          <Routes>
            <Route
              path="/"
              element={<Playground isMobileMenuOpen={isMobileMenuOpen} setIsMobileMenuOpen={setIsMobileMenuOpen} />}
            />
          </Routes>
        </div>

        {/* Footer */}
        <div className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-700 px-4 md:px-8 py-3">
          <p className="text-center text-gray-600 text-xs font-light dark:text-slate-400">
            <p className="mb-1 hidden sm:block">Colyseus is free and open-source. Your support helps keep it independent and thriving!</p>

            <a href="https://github.com/sponsors/endel" className="text-purple-700 hover:text-purple-500 dark:text-purple-400" target="_blank"> ❤️ Become a Sponsor</a>
            &nbsp;|&nbsp;
            <a
              href="https://github.com/colyseus/colyseus"
              target="_blank"
              className="text-purple-700 hover:text-purple-500 dark:text-purple-400"
              rel="noopener noreferrer"
            >
              ⭐ <span className="hidden sm:inline">Give it a star on </span>GitHub
            </a>
          </p>
        </div>

      </div>

    </div>
  );
};
