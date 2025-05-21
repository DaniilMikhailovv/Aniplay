// ==UserScript==
// @name         Aniplay
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  Коллапсируемая панель с ползунком управления framerate и паузой на Animate-страницах; отображение текущего framerate внутри контейнера с эффектом hover и появлением фона в hover-зоне
// @match        *://*/*
// @include      file:///*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Ждём появления createjs.Ticker и сохраняем FPS при старте
    function waitForCreatejsTickerAndInitPanel(maxWaitMs = 10000, intervalMs = 100) {
        const start = Date.now();
        (function check() {
            if (
                typeof createjs !== 'undefined' &&
                createjs.Ticker &&
                typeof createjs.Ticker.framerate === 'number' &&
                createjs.Ticker.framerate !== 20
            ) {
                const ORIGINAL_FPS = createjs.Ticker.framerate;
                console.log(`[Animate Panel] ORIGINAL_FPS при старте: ${ORIGINAL_FPS}`);
                initAnimatePanel(ORIGINAL_FPS);
            } else if (Date.now() - start < maxWaitMs) {
                setTimeout(check, intervalMs);
            } else {
                console.warn('[Animate Panel] createjs.Ticker.framerate не найден или не изменился с 20, панель не будет инициализирована');
            }
        })();
    }

    // Функция для управления шириной баннера
    function initBannerWidthControl() {
        // Проверяем наличие контейнера баннера
        const animationContainer = document.getElementById('animation_container');
        if (!animationContainer) {
            console.warn('[Banner Control] animation_container не найден');
            return;
        }

        // Заводим переменную-переключатель
        window.bannerWidthOverride = null;
        
        // Функция для сохранения настроек ширины
        function saveBannerWidthSettings(width, isActive) {
            try {
                localStorage.setItem('animateBannerWidth', width ? width.toString() : '');
                localStorage.setItem('animateBannerWidthActive', isActive ? 'true' : 'false');
                console.log(`[Banner Control] Сохранены настройки: ширина=${width}, активно=${isActive}`);
            } catch(e) {
                console.warn('[Banner Control] Ошибка при сохранении настроек ширины:', e);
            }
        }
        
        // Восстанавливаем сохраненные настройки
        let savedWidth = null;
        try {
            const savedWidthValue = localStorage.getItem('animateBannerWidth');
            if (savedWidthValue && !isNaN(savedWidthValue)) {
                savedWidth = parseInt(savedWidthValue);
                console.log(`[Banner Control] Восстановлена ширина: ${savedWidth}px`);
            }
        } catch(e) {
            console.warn('[Banner Control] Ошибка при чтении сохраненной ширины:', e);
        }
        
        // Восстанавливаем состояние активности
        let isWidthControlActive = false;
        try {
            isWidthControlActive = localStorage.getItem('animateBannerWidthActive') === 'true';
            console.log(`[Banner Control] Восстановлено состояние активности: ${isWidthControlActive}`);
        } catch(e) {
            console.warn('[Banner Control] Ошибка при чтении состояния активности:', e);
        }
        
        // Сохраняем исходную ширину баннера
        let originalWidth = null;
        
        // Сохраняем оригинальный дескриптор clientWidth
        let originalDescriptor;
        try {
            originalDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.documentElement), 'clientWidth');
        } catch (e) {
            console.warn('[Banner Control] Не удалось получить дескриптор свойства clientWidth:', e);
            originalDescriptor = null;
        }
        let isWidthOverridden = false;
        
        // Для блокировки переходов по ссылкам в баннере
        window.isBannerEditModeActive = false;
        
        // Функция для блокировки кликов по баннеру
        function blockBannerClicks() {
            if (!window.clickBlockerInstalled) {
                // Создаем функцию-обработчик
                window.bannerClickHandler = function(e) {
                    if (window.isBannerEditModeActive) {
                        // Блокируем переход по ссылкам внутри баннера
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[Banner Control] Клик по баннеру заблокирован');
                    }
                };
                
                // Находим все ссылки внутри баннера
                const bannerElement = document.getElementById('banner') || 
                                     document.querySelector('.banner') || 
                                     document.getElementById('animation_container');
                
                if (bannerElement) {
                    // Добавляем обработчик на уровень баннера для перехвата всех кликов
                    bannerElement.addEventListener('click', window.bannerClickHandler, true);
                    
                    // Для надежности - обработчик на уровне document
                    document.addEventListener('click', function(e) {
                        if (window.isBannerEditModeActive) {
                            // Проверяем, находится ли клик внутри баннера
                            let target = e.target;
                            while (target) {
                                if (target === bannerElement) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    console.log('[Banner Control] Клик по баннеру заблокирован (глубокий перехват)');
                                    return;
                                }
                                target = target.parentElement;
                            }
                        }
                    }, true);
                    
                    window.clickBlockerInstalled = true;
                    console.log('[Banner Control] Система блокировки кликов установлена');
                } else {
                    console.warn('[Banner Control] Не найден элемент баннера для блокировки кликов');
                }
            }
        }

        // Устанавливаем блокировщик кликов при инициализации
        blockBannerClicks();
        
        // Функция для переопределения clientWidth
        function overrideClientWidth() {
            if (isWidthOverridden) return;
            
            Object.defineProperty(document.documentElement, 'clientWidth', {
                get: function() {
                    return window.bannerWidthOverride !== null
                        ? window.bannerWidthOverride
                        : document.documentElement.getBoundingClientRect().width;
                },
                configurable: true
            });
            
            isWidthOverridden = true;
            console.log('[Banner Control] clientWidth переопределен');
        }
        
        // Функция для восстановления исходного clientWidth
        function restoreClientWidth() {
            if (!isWidthOverridden) return;
            
            // Удаляем переопределенное свойство
            delete document.documentElement.clientWidth;
            
            // Проверяем, был ли успешно сохранен оригинальный дескриптор
            if (originalDescriptor) {
                // Применяем оригинальный дескриптор
                Object.defineProperty(document.documentElement, 'clientWidth', originalDescriptor);
                console.log('[Banner Control] clientWidth восстановлен');
            } else {
                console.warn('[Banner Control] Невозможно восстановить оригинальный clientWidth');
            }
            
            isWidthOverridden = false;
        }

        // Создаём ползунок для изменения ширины
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, {
            position: 'absolute',
            right: '-10px',
            top: '0',
            width: '10px',
            height: '100%',
            cursor: 'ew-resize',
            background: 'rgba(0, 120, 255, 0.1)',
            zIndex: '9998',
            boxShadow: '0 0 2px rgba(0, 120, 255, 0.8)',
            transition: 'background 0.2s, opacity 0.3s',
            opacity: '0'  // Начальное состояние - скрыт
        });
        
        // Добавляем маркер-ручку для более удобного перетаскивания
        const dragHandle = document.createElement('div');
        Object.assign(dragHandle.style, {
            position: 'absolute',
            right: '0px',
            bottom: '-40px',
            width: '20px',
            height: '36px',
            background: 'rgba(80, 80, 80, 0.7)',
            borderRadius: '4px 0 0 4px',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
            zIndex: '9999',
            cursor: 'ew-resize',
            transition: 'background 0.2s, opacity 0.3s',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: '0'  // Начальное состояние - скрыт
        });
        
        // Добавляем внутренние полоски для визуального оформления маркера
        const handleLines = document.createElement('div');
        Object.assign(handleLines.style, {
            width: '8px',
            height: '18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
        });
        
        // Создаем три полоски внутри маркера
        for (let i = 0; i < 3; i++) {
            const line = document.createElement('div');
            Object.assign(line.style, {
                height: '2px',
                background: 'rgba(255, 255, 255, 0.9)',
                borderRadius: '1px'
            });
            handleLines.appendChild(line);
        }
        
        dragHandle.appendChild(handleLines);
        
        // Добавляем эффект при наведении
        dragHandle.addEventListener('mouseenter', () => {
            if (isWidthControlActive) {
                dragHandle.style.background = 'rgba(80, 80, 80, 0.9)';
            }
        });
        
        dragHandle.addEventListener('mouseleave', () => {
            if (isWidthControlActive) {
                dragHandle.style.background = 'rgba(80, 80, 80, 0.7)';
            }
        });
        
        // Добавляем эффект при наведении
        resizeHandle.addEventListener('mouseenter', () => {
            if (isWidthControlActive) {
                resizeHandle.style.background = 'rgba(0, 120, 255, 0.3)';
                dragHandle.style.background = 'rgba(80, 80, 80, 0.9)';
            }
        });
        
        resizeHandle.addEventListener('mouseleave', () => {
            if (isWidthControlActive) {
                resizeHandle.style.background = 'rgba(0, 120, 255, 0.1)';
                if (!dragHandle.matches(':hover')) {
                    dragHandle.style.background = 'rgba(80, 80, 80, 0.7)';
                }
            }
        });
        
        // Добавляем обработчик двойного клика для ручного ввода ширины
        function handleManualWidthInput() {
            if (!isWidthControlActive) return;
            
            // Получаем текущую ширину баннера
            const currentWidth = animationContainer.offsetWidth;
            
            // Показываем диалоговое окно для ввода новой ширины
            const newWidth = prompt(`Введите новую ширину баннера (текущая: ${currentWidth}px):`, currentWidth);
            
            // Проверяем введенное значение
            if (newWidth !== null && !isNaN(newWidth) && parseInt(newWidth) > 0) {
                // Устанавливаем минимальную ширину
                const width = Math.max(200, parseInt(newWidth));
                
                // Изменяем ширину контейнера
                animationContainer.style.width = `${width}px`;
                
                // Изменяем ширину canvas и dom_overlay_container
                const canvas = document.getElementById('canvas');
                const domOverlayContainer = document.getElementById('dom_overlay_container');
                
                if (canvas) canvas.style.width = `${width}px`;
                if (domOverlayContainer) domOverlayContainer.style.width = `${width}px`;
                
                // Устанавливаем значение для переопределения clientWidth
                window.bannerWidthOverride = width;
                
                // Вызываем событие resize для обновления баннера
                window.dispatchEvent(new Event('resize'));
                
                // Сохраняем новую ширину в localStorage
                saveBannerWidthSettings(width, isWidthControlActive);
            }
        }
        
        // Добавляем обработчики двойного клика для обоих элементов
        resizeHandle.addEventListener('dblclick', handleManualWidthInput);
        dragHandle.addEventListener('dblclick', handleManualWidthInput);

        // Логика перетаскивания (добавляем обработчик и для маркера)
        let isDragging = false;
        let startX, startWidth;

        function startDrag(e) {
            if (!isWidthControlActive) return;
            isDragging = true;
            startX = e.clientX;
            startWidth = animationContainer.offsetWidth;
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        }

        resizeHandle.addEventListener('mousedown', startDrag);
        dragHandle.addEventListener('mousedown', startDrag);

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            // Вычисляем новую ширину
            const newWidth = startWidth + (e.clientX - startX);
            
            // Устанавливаем минимальную ширину
            const width = Math.max(200, newWidth);
            
            // Изменяем ширину контейнера
            animationContainer.style.width = `${width}px`;
            
            // Изменяем ширину canvas и dom_overlay_container
            const canvas = document.getElementById('canvas');
            const domOverlayContainer = document.getElementById('dom_overlay_container');
            
            if (canvas) canvas.style.width = `${width}px`;
            if (domOverlayContainer) domOverlayContainer.style.width = `${width}px`;
            
            // Устанавливаем значение для переопределения clientWidth
            window.bannerWidthOverride = width;
            
            // Вызываем событие resize для обновления баннера
            window.dispatchEvent(new Event('resize'));
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                // Сохраняем текущую ширину при завершении перетаскивания
                saveBannerWidthSettings(window.bannerWidthOverride, isWidthControlActive);
                
                isDragging = false;
                document.body.style.cursor = '';
            }
        });

        // Функция для создания кнопки управления шириной
        function createWidthControlButton(scaleBox) {
            const widthControlBtn = document.createElement('button');
            widthControlBtn.title = 'Включить/выключить изменение ширины баннера';
            widthControlBtn.innerHTML = '<span class="material-icons" style="font-size:28px;">swap_horiz</span>';
            Object.assign(widthControlBtn.style, {
                width: '44px', 
                height: '44px',
                borderRadius: '8px',
                border: 'none', 
                background: 'rgba(0,0,0,0.5)', 
                color: '#fff', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: '0', 
                boxShadow: '0 2px 8px rgba(0,0,0,0.13)', 
                transition: 'background 0.18s, box-shadow 0.18s', 
                margin: '8px 0 0 0', 
                alignSelf: 'center',
            });
            
            widthControlBtn.addEventListener('mouseenter', () => { 
                widthControlBtn.style.background = 'rgba(255,255,255,0.2)'; 
            });
            
            widthControlBtn.addEventListener('mouseleave', () => { 
                widthControlBtn.style.background = isWidthControlActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)'; 
            });
            
            widthControlBtn.addEventListener('mousedown', () => { 
                widthControlBtn.style.background = 'rgba(255,255,255,0.32)'; 
            });
            
            widthControlBtn.addEventListener('mouseup', () => { 
                widthControlBtn.style.background = 'rgba(255,255,255,0.2)'; 
            });
            
            // Обработчик клика для включения/выключения режима изменения ширины
            widthControlBtn.addEventListener('click', () => {
                isWidthControlActive = !isWidthControlActive;
                
                // Обновляем глобальное состояние режима изменения ширины
                window.isWidthControlActive = isWidthControlActive;
                
                // Обновляем глобальное состояние режима редактирования баннера
                window.isBannerEditModeActive = isWidthControlActive || 
                    (window.isRulersActive === true);
                
                if (isWidthControlActive) {
                    // Активируем режим изменения ширины
                    
                    // Сохраняем исходный размер при активации
                    if (originalWidth === null) {
                        originalWidth = animationContainer.offsetWidth;
                    }
                    
                    // Если есть сохраненная ширина, применяем её
                    if (savedWidth !== null && savedWidth >= 200) {
                        animationContainer.style.width = `${savedWidth}px`;
                        
                        const canvas = document.getElementById('canvas');
                        const domOverlayContainer = document.getElementById('dom_overlay_container');
                        
                        if (canvas) canvas.style.width = `${savedWidth}px`;
                        if (domOverlayContainer) domOverlayContainer.style.width = `${savedWidth}px`;
                        
                        // Устанавливаем значение для переопределения clientWidth
                        window.bannerWidthOverride = savedWidth;
                        
                        // Вызываем событие resize для обновления баннера
                        window.dispatchEvent(new Event('resize'));
                        
                        console.log(`[Banner Control] Применена сохраненная ширина: ${savedWidth}px`);
                    }
                    
                    // Переопределяем clientWidth
                    overrideClientWidth();
                } else {
                    // Выключаем режим изменения ширины
                    
                    // Сбрасываем переопределение clientWidth
                    window.bannerWidthOverride = null;
                    
                    // Восстанавливаем оригинальное поведение clientWidth
                    restoreClientWidth();
                    
                    // Восстанавливаем исходные размеры элементов, если они были сохранены
                    if (originalWidth !== null) {
                        animationContainer.style.width = `${originalWidth}px`;
                        
                        const canvas = document.getElementById('canvas');
                        const domOverlayContainer = document.getElementById('dom_overlay_container');
                        
                        if (canvas) canvas.style.width = `${originalWidth}px`;
                        if (domOverlayContainer) domOverlayContainer.style.width = `${originalWidth}px`;
                        
                        // Вызываем событие resize для обновления баннера
                        window.dispatchEvent(new Event('resize'));
                    }
                }
                
                // Сохраняем состояние
                saveBannerWidthSettings(
                    isWidthControlActive ? window.bannerWidthOverride : null, 
                    isWidthControlActive
                );
                
                // Меняем цвет кнопки в зависимости от состояния
                widthControlBtn.style.background = isWidthControlActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';
                
                // Показываем/скрываем элементы контроля ширины
                resizeHandle.style.opacity = isWidthControlActive ? '1' : '0';
                dragHandle.style.opacity = isWidthControlActive ? '1' : '0';
                
                // Включаем/отключаем перетаскивание
                resizeHandle.style.pointerEvents = isWidthControlActive ? 'auto' : 'none';
                dragHandle.style.pointerEvents = isWidthControlActive ? 'auto' : 'none';
            });
            
            // Добавляем кнопку в scaleBox
            scaleBox.appendChild(widthControlBtn);
            
            return widthControlBtn;
        }

        // Добавляем ползунок и маркер к контейнеру
        animationContainer.appendChild(resizeHandle);
        animationContainer.appendChild(dragHandle);
        
        // Если режим изменения ширины был активен до перезагрузки,
        // активируем его автоматически
        if (isWidthControlActive) {
            // Показываем элементы управления
            resizeHandle.style.opacity = '1';
            dragHandle.style.opacity = '1';
            resizeHandle.style.pointerEvents = 'auto';
            dragHandle.style.pointerEvents = 'auto';
            
            // Обновляем глобальное состояние
            window.isWidthControlActive = true;
            window.isBannerEditModeActive = true || (window.isRulersActive === true);
            
            // Сохраняем исходный размер
            if (originalWidth === null) {
                originalWidth = animationContainer.offsetWidth;
            }
            
            // Если есть сохраненная ширина, применяем её
            if (savedWidth !== null && savedWidth >= 200) {
                animationContainer.style.width = `${savedWidth}px`;
                
                const canvas = document.getElementById('canvas');
                const domOverlayContainer = document.getElementById('dom_overlay_container');
                
                if (canvas) canvas.style.width = `${savedWidth}px`;
                if (domOverlayContainer) domOverlayContainer.style.width = `${savedWidth}px`;
                
                // Устанавливаем значение для переопределения clientWidth
                window.bannerWidthOverride = savedWidth;
                
                // Переопределяем clientWidth
                overrideClientWidth();
                
                // Вызываем событие resize для обновления баннера
                window.dispatchEvent(new Event('resize'));
                
                console.log(`[Banner Control] Автоматически активирован режим изменения ширины с шириной: ${savedWidth}px`);
            }
        }
        
        // Сохраняем функцию для последующего использования
        window.createWidthControlButton = createWidthControlButton;
        
        console.log('[Banner Control] Управление шириной баннера инициализировано');
    }

    function initAnimatePanel(ORIGINAL_FPS) {
        // Проверка Animate-страницы
        const isAnimateCC = !!document.querySelector('meta[name="authoring-tool"][content*="Adobe_Animate_CC"]');
        if (!isAnimateCC) return;
        console.log('[Animate Panel] Adobe Animate страница обнаружена');
        if (typeof ORIGINAL_FPS === 'undefined') {
            console.warn('[Animate Panel] ORIGINAL_FPS не найден: сброс FPS работать не будет');
        } else {
            console.log(`[Animate Panel] ORIGINAL_FPS: ${ORIGINAL_FPS}`);
        }
        
        // Подключаем Material Icons
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        
        // Инициализируем управление шириной баннера
        initBannerWidthControl();

        // Настройки фона
        const bgExpanded = 'rgba(0, 0, 0, 0.7)'; 
        const bgCollapsed = 'transparent';

        // Создаём панель
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'fixed',
            top: '16px',
            left: '16px',
            background: bgExpanded,
            borderRadius: '10px',
            padding: '7px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transition: 'width 0.2s, height 0.2s, background 0.2s, opacity 0.2s',
            overflow: 'hidden',
            minWidth: '52px',
            fontFamily: 'Arial, sans-serif',
            boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
            opacity: '1',
            pointerEvents: 'auto',
            width: 'auto',
            height: 'auto',
            paddingTop: '36px',
        });

        // Контейнер кнопок + счетчика
        const btnContainer = document.createElement('div');
        Object.assign(btnContainer.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
            marginTop: '6px',
            alignItems: 'center',
            width: '100%'
        });

        // === FPS drag-инпут ===
        const fpsDragContainer = document.createElement('div');
        Object.assign(fpsDragContainer.style, {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            margin: '2px 0',
            padding: '2px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            gap: '5px',
            userSelect: 'none',
        });
        // Окно FPS
        const fpsValueBox = document.createElement('div');
        Object.assign(fpsValueBox.style, {
            minWidth: '26px',
            padding: '2px 4px',
            fontSize: '13px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(30,30,30,0.85)',
            borderRadius: '6px',
            border: '1.5px solid #444',
            textAlign: 'center',
            cursor: 'ew-resize',
            letterSpacing: '0.5px',
            transition: 'background 0.15s, border 0.15s',
            outline: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.13)',
            userSelect: 'none',
        });
        fpsValueBox.title = 'Потяните влево/вправо для изменения FPS, двойной клик — сброс';
        fpsDragContainer.appendChild(fpsValueBox);
        btnContainer.appendChild(fpsDragContainer);
        // Логика drag
        let dragActive = false;
        let dragStartX = 0;
        let dragStartFps = 0;
        const FPS_MIN = 1;
        const FPS_MAX = 99;
        function setFps(val) {
            val = Math.round(Math.max(FPS_MIN, Math.min(FPS_MAX, val)));
            if (typeof createjs !== 'undefined' && createjs.Ticker) {
                createjs.Ticker.framerate = val;
            }
            fpsValueBox.textContent = val;
        }
        // Инициализация значения
        let initialFps = 30;
        if (typeof createjs !== 'undefined' && createjs.Ticker && createjs.Ticker.framerate) {
            initialFps = createjs.Ticker.framerate;
        }
        setFps(initialFps);
        // Drag events
        fpsValueBox.addEventListener('mousedown', (e) => {
            dragActive = true;
            dragStartX = e.clientX;
            dragStartFps = typeof createjs !== 'undefined' && createjs.Ticker ? createjs.Ticker.framerate : initialFps;
            fpsValueBox.style.background = 'rgba(60,60,60,0.95)';
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragActive) return;
            const dx = e.clientX - dragStartX;
            let newFps = dragStartFps + Math.round(dx / 3); // 3px = 1 FPS
            setFps(newFps);
        });
        window.addEventListener('mouseup', () => {
            if (dragActive) {
                dragActive = false;
                fpsValueBox.style.background = 'rgba(30,30,30,0.85)';
                document.body.style.cursor = '';
            }
        });
        // Двойной клик — сброс к исходному FPS
        fpsValueBox.addEventListener('dblclick', () => {
            if (typeof createjs !== 'undefined' && createjs.Ticker && typeof ORIGINAL_FPS !== 'undefined') {
                setFps(ORIGINAL_FPS);
            }
        });
        // Синхронизация при внешнем изменении FPS
        function syncFpsBox() {
        if (typeof createjs !== 'undefined' && createjs.Ticker) {
                fpsValueBox.textContent = Math.round(createjs.Ticker.framerate);
            }
        }
        setInterval(syncFpsBox, 500);

        // === Слайдер кадров ===
        const frameSliderContainer = document.createElement('div');
        Object.assign(frameSliderContainer.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            margin: '4px 0',
            padding: '4px 0',
            background: 'rgba(0,0,0,0.18)',
            borderRadius: '6px',
            gap: '4px',
            minHeight: 'unset',
            minWidth: '0',
            justifyContent: 'center'
        });

        // Вертикальный слайдер кадров
        const frameSlider = document.createElement('input');
        frameSlider.type = 'range';
        frameSlider.min = '0';
        frameSlider.value = '0';
        Object.assign(frameSlider.style, {
            width: '18px',
            height: '90px',
            appearance: 'none',
            background: 'rgba(204, 204, 204, 0.3)',
            outline: 'none',
            borderRadius: '7px',
            cursor: 'pointer',
            writingMode: 'bt-lr',
            WebkitAppearance: 'slider-vertical',
            transform: 'rotate(180deg)',
            margin: '0 4px 0 0',
            display: 'block',
        });
        frameSlider.disabled = true;
        frameSlider.classList.add('frame-slider');
        frameSliderContainer.appendChild(frameSlider);

        // === Drag-инпут выбора кадра ===
        const frameDragBox = document.createElement('div');
        Object.assign(frameDragBox.style, {
            minWidth: '32px',
            padding: '4px 8px',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            background: 'rgba(30,30,30,0.85)',
            borderRadius: '6px',
            border: '1.5px solid #444',
            textAlign: 'center',
            cursor: 'ew-resize',
            letterSpacing: '0.5px',
            transition: 'background 0.15s, border 0.15s',
            outline: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.13)',
            userSelect: 'none',
            margin: '4px 0 0 0',
            alignSelf: 'center',
        });
        frameDragBox.title = 'Потяните влево/вправо для выбора кадра, двойной клик — первый кадр';
        frameSliderContainer.appendChild(frameDragBox);
        // Логика drag для кадров
        let frameDragActive = false;
        let frameDragStartX = 0;
        let frameDragStartVal = 1;
        let frameDragMax = 1;
        function setFrameDrag(val) {
            val = Math.max(1, Math.min(frameDragMax, Math.round(val)));
            if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                window.exportRoot.gotoAndStop(val - 1);
                fullUpdateSlider();
            }
            frameDragBox.textContent = val;
        }
        frameDragBox.addEventListener('mousedown', (e) => {
            frameDragActive = true;
            frameDragStartX = e.clientX;
            frameDragStartVal = parseInt(frameDragBox.textContent, 10) || 1;
            frameDragBox.style.background = 'rgba(60,60,60,0.95)';
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
            if (!frameDragActive) return;
            const dx = e.clientX - frameDragStartX;
            let newVal = frameDragStartVal + Math.round(dx / 4); // 4px = 1 кадр
            setFrameDrag(newVal);
        });
        window.addEventListener('mouseup', () => {
            if (frameDragActive) {
                frameDragActive = false;
                frameDragBox.style.background = 'rgba(30,30,30,0.85)';
                document.body.style.cursor = '';
            }
        });
        // Двойной клик — первый кадр
        frameDragBox.addEventListener('dblclick', () => {
            setFrameDrag(1);
        });
        // Синхронизация при внешнем изменении кадра
        function syncFrameDragBox() {
            if (typeof window.exportRoot !== 'undefined') {
                let currentFrame = 0;
                let totalFrames = 1;
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }
                frameDragMax = totalFrames;
                frameDragBox.textContent = (currentFrame + 1).toString();
            }
        }
        setInterval(syncFrameDragBox, 300);

        // Добавляем стили для тонкого трека и круглого маркера
        const frameSliderStyles = `
            input[type=range].frame-slider::-webkit-slider-thumb {
                appearance: none;
                width: 22px;
                height: 22px;
                background: #E0E0E0;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.13);
                border: 1px solid rgba(142, 142, 147, 0.5);
                margin-top: -9px;
            }
            input[type=range].frame-slider::-moz-range-thumb {
                width: 22px;
                height: 22px;
                background: #E0E0E0;
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0,0,0,0.13);
                border: 1px solid rgba(142, 142, 147, 0.5);
            }
            input[type=range].frame-slider::-webkit-slider-runnable-track {
                height: 8px;
                background: rgba(204, 204, 204, 0.5);
                border-radius: 4px;
            }
            input[type=range].frame-slider::-moz-range-track {
                height: 8px;
                background: rgba(204, 204, 204, 0.5);
                border-radius: 4px;
            }
            input[type=range].frame-slider {
                background: transparent;
                padding: 0;
                margin: 0;
            }
        `;
        const frameSliderStyleElement = document.createElement('style');
        frameSliderStyleElement.textContent = frameSliderStyles;
        document.head.appendChild(frameSliderStyleElement);
        
        // Обновление слайдера в реальном времени
        let isRafActive = true;
        let lastFrame = -1; // Для отслеживания изменений кадра
        let frameHistory = []; // История последних кадров
        
        function rafUpdateSlider() {
            if (isRafActive) {
                if (typeof window.exportRoot !== 'undefined') {
                    let currentFrame = 0;
                    
                    // Получаем текущий кадр
                    if (typeof window.exportRoot.currentFrame === 'number') {
                        currentFrame = window.exportRoot.currentFrame;
                    } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                        currentFrame = window.exportRoot.timeline.position;
                    }
                    
                    // Проверяем, изменился ли кадр
                    if (currentFrame !== lastFrame) {
                        // Обновляем слайдер только если не перетаскиваем его
                        if (!frameDragActive) {
                            frameSlider.value = currentFrame.toString();
                            frameDragBox.textContent = (currentFrame + 1).toString();
                        }
                        
                        // Сохраняем историю кадров для отладки
                        frameHistory.push(currentFrame);
                        if (frameHistory.length > 10) {
                            frameHistory.shift();
                        }
                        
                        lastFrame = currentFrame;
                    }
                }
                
                requestAnimationFrame(rafUpdateSlider);
            }
        }
        requestAnimationFrame(rafUpdateSlider);

        // Полное обновление слайдера (включая min/max)
        function fullUpdateSlider() {
            if (typeof window.exportRoot !== 'undefined') {
                let totalFrames = 0;
                let currentFrame = 0;
                
                // Получаем общее количество кадров
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }
                
                // Получаем текущий кадр
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }
                
                if (totalFrames > 0) {
                    frameSlider.max = (totalFrames - 1).toString();
                    
                    // Обновляем положение слайдера только если не перетаскиваем его
                    if (!frameDragActive) {
                        frameSlider.value = currentFrame.toString();
                        frameDragBox.textContent = (currentFrame + 1).toString();
                    }
                    
                    frameSlider.disabled = false;
                } else {
                    frameSlider.disabled = true;
                    frameDragBox.textContent = '-';
                }
            } else {
                frameSlider.disabled = true;
                frameDragBox.textContent = '-';
            }
        }

        // Периодически делаем полное обновление слайдера
        const fullUpdateInterval = setInterval(fullUpdateSlider, 300);

        // Слайдер перемещает по кадрам
        frameSlider.addEventListener('input', () => {
            if (typeof window.exportRoot !== 'undefined') {
                const frame = parseInt(frameSlider.value, 10);
                if (typeof window.exportRoot.gotoAndStop === 'function') {
                    window.exportRoot.gotoAndStop(frame);
                    fullUpdateSlider();
                    lastFrame = frame; // Обновляем lastFrame чтобы избежать ненужных обновлений
                }
            }
        });

        // При удалении панели очищаем requestAnimationFrame и интервал
        panel.addEventListener('remove', () => {
            isRafActive = false;
            clearInterval(fullUpdateInterval);
        });

        // === Кнопка и контейнер для маркеров ===
        const markerRow = document.createElement('div');
        Object.assign(markerRow.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            margin: '4px 0 0 0',
            maxHeight: '200px', // Ограничиваем высоту
            overflowY: 'auto', // Добавляем прокрутку если маркеров много
            overflowX: 'hidden',
            width: '100%',
            alignItems: 'center',
            minHeight: '28px',
            padding: '2px'
        });
        frameSliderContainer.appendChild(markerRow);

        const addMarkerBtn = document.createElement('button');
        addMarkerBtn.textContent = '+';
        Object.assign(addMarkerBtn.style, {
            width: '44px',
            height: '20px',
            fontSize: '15px',
            borderRadius: '6px',
            border: 'none',
            background: '#3a3a3a',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 'bold',
            margin: '0 0 4px 0',
            transition: 'background 0.2s',
            outline: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.13)'
        });
        addMarkerBtn.title = 'Добавить маркер на этот кадр';
        addMarkerBtn.addEventListener('mouseenter', () => { addMarkerBtn.style.background = '#555'; });
        addMarkerBtn.addEventListener('mouseleave', () => { addMarkerBtn.style.background = '#3a3a3a'; });
        frameSliderContainer.appendChild(addMarkerBtn);

        let frameMarkers = [];
        function renderMarkers() {
            markerRow.innerHTML = '';
            frameMarkers.sort((a, b) => a - b);
            frameMarkers.forEach(frame => {
                const btn = document.createElement('button');
                btn.style.position = 'relative';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'space-between';
                Object.assign(btn.style, {
                    width: '44px',
                    height: '20px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#e0e0e0',
                    color: '#222',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    margin: '1px 0',
                    padding: '0 6px',
                    transition: 'background 0.2s',
                    outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                });
                btn.title = `Перейти к кадру ${frame + 1}`;
                btn.addEventListener('mouseenter', () => { btn.style.background = '#bdbdbd'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = '#e0e0e0'; });
                // Клик по номеру — переход
                btn.addEventListener('click', (e) => {
                    // Если клик по крестику — не переходить
                    if (e.target.classList.contains('marker-remove')) return;
                    if (typeof window.exportRoot !== 'undefined' && typeof window.exportRoot.gotoAndStop === 'function') {
                        window.exportRoot.gotoAndStop(frame);
                        fullUpdateSlider();
                    }
                });
                // Номер кадра
                const numSpan = document.createElement('span');
                numSpan.textContent = (frame + 1).toString();
                numSpan.style.pointerEvents = 'none';
                btn.appendChild(numSpan);
                // Крестик для удаления
                const removeBtn = document.createElement('span');
                removeBtn.textContent = '×';
                removeBtn.className = 'marker-remove';
                Object.assign(removeBtn.style, {
                    fontSize: '14px',
                    color: '#b00',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    lineHeight: '1',
                    fontWeight: 'bold',
                    padding: '0 0 0 4px'
                });
                removeBtn.title = 'Удалить маркер';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    frameMarkers = frameMarkers.filter(f => f !== frame);
                    renderMarkers();
                });
                btn.appendChild(removeBtn);
                markerRow.appendChild(btn);
            });
        }
        addMarkerBtn.addEventListener('click', () => {
            let val = parseInt(frameDragBox.textContent, 10);
            if (isNaN(val) || val < 1) return;
            const frame = val - 1;
            if (!frameMarkers.includes(frame)) {
                frameMarkers.push(frame);
                renderMarkers();
            }
        });

        btnContainer.appendChild(frameSliderContainer);

        // Добавляем кнопку паузы
        const pauseBtn = document.createElement('button');
        const pauseIcon = document.createElement('span');
        pauseIcon.className = 'material-icons';
        pauseIcon.textContent = 'pause'; // Начальное состояние - показываем паузу (т.к. анимация по умолчанию воспроизводится)
        pauseBtn.appendChild(pauseIcon);
        pauseBtn.title = 'Остановить воспроизведение';
        Object.assign(pauseBtn.style, {
            width: '44px',
            height: '44px',
            padding: '0',
            margin: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            cursor: 'pointer',
            transition: 'background 0.2s',
            fontSize: '22px'
        });
        
        // hover
        pauseBtn.addEventListener('mouseenter', () => { pauseBtn.style.background = 'rgba(255,255,255,0.2)'; });
        pauseBtn.addEventListener('mouseleave', () => { pauseBtn.style.background = 'rgba(0,0,0,0.5)'; });
        
        // Обновление иконки и заголовка в зависимости от состояния
        function updatePauseButton() {
            if (typeof window.exportRoot !== 'undefined') {
                if (window.exportRoot.paused) {
                    pauseIcon.textContent = 'play_arrow';
                    pauseBtn.title = 'Запустить воспроизведение';
                } else {
                    pauseIcon.textContent = 'pause';
                    pauseBtn.title = 'Остановить воспроизведение';
                }
            }
        }
        
        // Обработчик клика
        pauseBtn.addEventListener('click', () => {
            if (typeof window.exportRoot !== 'undefined') {
                window.exportRoot.paused = !window.exportRoot.paused;
                updatePauseButton();
                console.log(`[Paused toggle] ${window.exportRoot.paused}`);
            }
        });
        
        btnContainer.appendChild(pauseBtn);
        
        // Функция создания кнопки с иконкой и hover-эффектом - оставляем для возможного использования в будущем
        function addIconButton(iconName, title, onClick) {
            const btn = document.createElement('button');
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.textContent = iconName;
            btn.appendChild(icon);
            btn.title = title;
            Object.assign(btn.style, {
                width: '32px',
                height: '32px',
                padding: '0',
                margin: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
                transition: 'background 0.2s'
            });
            // hover
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.2)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(0,0,0,0.5)'; });
            btn.addEventListener('click', () => { onClick(); });
            btnContainer.appendChild(btn);
        }

        // === Кнопка сворачивания ===
        const collapseBtn = document.createElement('button');
        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'material-icons';
        collapseIcon.textContent = 'chevron_left';
        collapseBtn.appendChild(collapseIcon);
        Object.assign(collapseBtn.style, {
            position: 'absolute',
            top: '8px',
            left: '8px',
            right: 'auto',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.18)',
            border: 'none',
            borderRadius: '50%',
            color: '#fff',
            cursor: 'pointer',
            zIndex: '10001',
            fontSize: '22px',
            transition: 'background 0.2s',
        });
        collapseBtn.addEventListener('mouseenter', () => { collapseBtn.style.background = 'rgba(255,255,255,0.18)'; });
        collapseBtn.addEventListener('mouseleave', () => { collapseBtn.style.background = 'rgba(0,0,0,0.18)'; });
        panel.appendChild(collapseBtn);
        panel.style.position = 'fixed';
        panel.style.top = '16px';
        panel.style.left = '16px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.minWidth = '52px';
        panel.style.minHeight = '52px';
        panel.style.boxSizing = 'border-box';
        panel.style.paddingTop = '36px';
        // Состояние
        let isCollapsed = false;
        // Восстанавливаем состояние из localStorage
        const savedPanelCollapsed = localStorage.getItem('animatePanelCollapsed');
        if (savedPanelCollapsed === 'true') isCollapsed = true;
        function setPanelCollapsed(collapsed) {
            isCollapsed = collapsed;
            localStorage.setItem('animatePanelCollapsed', collapsed ? 'true' : 'false');
            if (collapsed) {
                btnContainer.style.display = 'none';
                panel.style.width = '52px';
                panel.style.height = '52px';
                panel.style.minWidth = '52px';
                panel.style.minHeight = '52px';
                collapseIcon.textContent = 'chevron_right';
                
                // Сделаем панель почти невидимой в свернутом состоянии
                panel.style.opacity = '0.00';
                
                // Удаляем класс развернутой панели и добавляем класс свернутой
                panel.classList.remove('panel-expanded');
                panel.classList.add('panel-collapsed');
            } else {
                btnContainer.style.display = 'flex';
                panel.style.width = 'auto';
                panel.style.height = 'auto';
                panel.style.minWidth = '52px';
                panel.style.minHeight = '52px';
                collapseIcon.textContent = 'chevron_left';
                
                // Сделаем панель полностью видимой в развернутом состоянии
                panel.style.opacity = '1';
                
                // Удаляем класс свернутой панели и добавляем класс развернутой
                panel.classList.remove('panel-collapsed');
                panel.classList.add('panel-expanded');
            }
        }
        setPanelCollapsed(isCollapsed);
        
        // Добавляем события для отображения свернутой панели при наведении
        panel.addEventListener('mouseenter', () => {
            // Показываем панель при наведении только если она свернута
            if (isCollapsed) {
                panel.style.opacity = '1';
            }
        });
        
        panel.addEventListener('mouseleave', () => {
            // Скрываем панель при уходе курсора только если она свернута
            if (isCollapsed) {
                panel.style.opacity = '0.00';
            }
        });
        
        // Делаем плавный переход для opacity
        panel.style.transition = 'opacity 0.3s, width 0.2s, height 0.2s, background 0.2s';
        
        // === devicePixelRatio compensation ===
        function getZoomCompensated(val) {
            return Math.round(val);
        }
        function getUnzoomCompensated(val) {
            return Math.round(val);
        }

        // === Масштаб панели ===
        let panelScale = 1.0;
        const SCALE_MIN = 0.5;
        const SCALE_MAX = 2.0;
        const SCALE_STEP = 0.1;

        function savePanelScale() {
            localStorage.setItem('animatePanelScale', panelScale.toString());
        }

        // Загружаем сохраненный масштаб
        try {
            const savedScale = parseFloat(localStorage.getItem('animatePanelScale'));
            if (!isNaN(savedScale) && savedScale >= SCALE_MIN && savedScale <= SCALE_MAX) {
                panelScale = savedScale;
            }
        } catch (e) {
            console.warn('Ошибка при загрузке сохраненного масштаба:', e);
        }

        // Добавляем элемент для изменения размера
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, {
            position: 'absolute',
            right: '0',
            bottom: '0',
            width: '20px',
            height: '20px',
            cursor: 'nwse-resize',
            zIndex: '10003',
            background: 'transparent',
            opacity: '0.001', // Почти прозрачный, но реагирует на события
        });

        // Добавляем визуальный индикатор
        const resizeIcon = document.createElement('div');
        Object.assign(resizeIcon.style, {
            position: 'absolute',
            right: '4px',
            bottom: '4px',
            width: '12px',
            height: '12px',
            pointerEvents: 'none',
            borderRight: '2px solid rgba(255,255,255,0.5)',
            borderBottom: '2px solid rgba(255,255,255,0.5)',
            opacity: '0.7',
        });

        panel.appendChild(resizeHandle);
        panel.appendChild(resizeIcon);

        // Обработка перетаскивания для изменения масштаба
        let isResizing = false;
        let resizeStartX = 0;
        let resizeStartScale = 1.0;

        resizeHandle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartScale = panelScale;
            document.body.style.cursor = 'nwse-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            
            const dx = e.clientX - resizeStartX;
            const scaleDelta = dx * 0.005; // Коэффициент чувствительности
            const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, resizeStartScale + scaleDelta));
            
            if (newScale !== panelScale) {
                panelScale = newScale;
                applyPanelScaleAndZoom();
                savePanelScale();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
            }
        });

        function applyPanelScaleAndZoom() {
            const zoom = (1 / window.devicePixelRatio) * panelScale;
            panel.style.transform = `scale(${zoom})`;
            panel.style.transformOrigin = 'top left';
        }
        applyPanelScaleAndZoom();
        
        function setPanelPosition(left, top) {
            // Получаем размеры окна браузера
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            // Получаем размеры панели
            const panelRect = panel.getBoundingClientRect();
            const panelWidth = panelRect.width / (1 / window.devicePixelRatio * panelScale);
            const panelHeight = panelRect.height / (1 / window.devicePixelRatio * panelScale);
            
            // Ограничиваем позицию панели границами окна браузера
            // Добавляем небольшой запас, чтобы панель не прилипала вплотную к краю
            const buffer = 5;
            
            // Ограничиваем левую и правую границы
            left = Math.max(buffer, Math.min(left, windowWidth - panelWidth - buffer));
            
            // Ограничиваем верхнюю и нижнюю границы
            // Учитываем наличие информационной панели внизу (24px)
            const bottomBarHeight = 24;
            top = Math.max(buffer, Math.min(top, windowHeight - panelHeight - bottomBarHeight - buffer));
            
            // Устанавливаем позицию
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
        setPanelPosition(16, 16);

        // При изменении devicePixelRatio пересчитать transform и позицию
        window.addEventListener('resize', () => {
            applyPanelScaleAndZoom();
            const rect = panel.getBoundingClientRect();
            
            // После изменения размера окна проверяем, не выходит ли панель за его пределы
            setPanelPosition(rect.left, rect.top);
        });

        // Обработчик колесика мыши для масштабирования
        panel.addEventListener('wheel', (e) => {
            if (!e.altKey) return; // Только при зажатом Alt

            e.preventDefault();
            const direction = e.deltaY < 0 ? 1 : -1;
            const oldScale = panelScale;
            panelScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, panelScale + direction * SCALE_STEP));
            
            if (oldScale !== panelScale) {
                const rect = panel.getBoundingClientRect();
                applyPanelScaleAndZoom();
                savePanelScale();
            }
        });

        // === Drag&Drop только за collapseBtn ===
        collapseBtn.style.cursor = 'move';
        let panelDragActive = false;
        let panelDragStartX = 0;
        let panelDragStartY = 0;
        let panelStartLeft = 16;
        let panelStartTop = 16;
        let panelDragMoved = false;
        collapseBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            panelDragActive = true;
            panelDragMoved = false;
            panelDragStartX = e.clientX;
            panelDragStartY = e.clientY;
            // panelStartLeft/Top в логических px
            const rect = panel.getBoundingClientRect();
            panelStartLeft = getUnzoomCompensated(rect.left);
            panelStartTop = getUnzoomCompensated(rect.top);
            panel.style.transition = 'none';
            document.body.style.cursor = 'move';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!panelDragActive) return;
            const dx = e.clientX - panelDragStartX;
            const dy = e.clientY - panelDragStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panelDragMoved = true;
            setPanelPosition(panelStartLeft + dx, panelStartTop + dy);
        });
        window.addEventListener('mouseup', () => {
            if (panelDragActive) {
                panelDragActive = false;
                panel.style.transition = '';
                document.body.style.cursor = '';
            }
        });

        // === Кнопка включения/выключения линеек ===
        const scaleBox = document.createElement('div');
        Object.assign(scaleBox.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: '10002',
            margin: '8px 0 0 0',
            alignSelf: 'center',
            justifyContent: 'center',
            alignItems: 'center',
        });

        const rulersBtn = document.createElement('button');
        rulersBtn.title = 'Показать/скрыть линейки и гайды';
        rulersBtn.innerHTML = '<span class="material-icons" style="font-size:28px;">straighten</span>';
        Object.assign(rulersBtn.style, {
            width: '44px', height: '44px',
            borderRadius: '8px',
            border: 'none', 
            background: 'rgba(0,0,0,0.5)', 
            color: '#fff', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            padding: '0', 
            boxShadow: '0 2px 8px rgba(0,0,0,0.13)', 
            transition: 'background 0.18s, box-shadow 0.18s', 
            margin: '0 0 0 0', 
            alignSelf: 'center',
        });
        
        // Состояние активности линеек
        window.isRulersActive = false;
        
        // Обновление цвета кнопки в зависимости от состояния
        function updateRulersBtnColor() {
            // Используем тот же зеленый цвет, что и для кнопки изменения ширины
            rulersBtn.style.background = window.isRulersActive ? 'rgba(0,180,0,0.5)' : 'rgba(0,0,0,0.5)';
        }
        
        rulersBtn.addEventListener('mouseenter', () => { 
            rulersBtn.style.background = 'rgba(255,255,255,0.2)'; 
        });
        
        rulersBtn.addEventListener('mouseleave', () => { 
            // При уходе мыши восстанавливаем цвет в зависимости от состояния
            updateRulersBtnColor();
        });
        
        rulersBtn.addEventListener('mousedown', () => { 
            rulersBtn.style.background = 'rgba(255,255,255,0.32)'; 
        });
        
        rulersBtn.addEventListener('mouseup', () => { 
            rulersBtn.style.background = 'rgba(255,255,255,0.2)'; 
        });
        
        // Вставляем кнопку rulersBtn в scaleBox
        scaleBox.appendChild(rulersBtn);
        
        // Добавляем кнопку управления шириной баннера
        if (window.createWidthControlButton) {
            window.createWidthControlButton(scaleBox);
        }
        
        btnContainer.appendChild(scaleBox);

        // Показывать кнопки только если панель развернута
        function updateScaleBoxVisibility() {
            scaleBox.style.display = isCollapsed ? 'none' : 'flex';
        }
        updateScaleBoxVisibility();
        // Вызов при изменении состояния панели
        const origSetPanelCollapsed = setPanelCollapsed;
        setPanelCollapsed = function(collapsed) {
            origSetPanelCollapsed(collapsed);
            updateScaleBoxVisibility();
        };
        // Обработчик кнопки сворачивания
        collapseBtn.addEventListener('click', (e) => {
            if (panelDragMoved) {
                panelDragMoved = false;
                return;
            }
            setPanelCollapsed(!isCollapsed);
        });

        // === Контейнер для линеек и гайдов ===
        const rulersOverlay = document.createElement('div');
        Object.assign(rulersOverlay.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: '2147483646',
        });
        rulersOverlay.style.display = 'none';
        document.body.appendChild(rulersOverlay);

        // Горизонтальная линейка
        const rulerH = document.createElement('canvas');
        rulerH.width = window.innerWidth;
        rulerH.height = 24;
        Object.assign(rulerH.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '100vw',
            height: '24px',
            background: 'rgba(30,30,30,0.01)', // Еще более прозрачный фон
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: 'ns-resize', // Курсор для перетаскивания
            transition: 'background 0.2s', // Плавный переход при наведении
        });
        rulersOverlay.appendChild(rulerH);

        // Вертикальная линейка
        const rulerV = document.createElement('canvas');
        rulerV.width = 24;
        rulerV.height = window.innerHeight;
        Object.assign(rulerV.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '24px',
            height: '100vh',
            background: 'rgba(30,30,30,0.01)', // Еще более прозрачный фон
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: 'ew-resize', // Курсор для перетаскивания
            transition: 'background 0.2s', // Плавный переход при наведении
        });
        rulersOverlay.appendChild(rulerV);

        // Добавляем обработчики для изменения видимости линеек при наведении
        let isRulerHHovered = false;
        let isRulerVHovered = false;
        
        rulerH.addEventListener('mouseenter', () => {
            isRulerHHovered = true;
            rulerH.style.background = 'rgba(30,30,30,0.3)';
            drawRulers();
        });
        rulerH.addEventListener('mouseleave', () => {
            isRulerHHovered = false;
            rulerH.style.background = 'rgba(30,30,30,0.01)';
            drawRulers();
        });
        
        rulerV.addEventListener('mouseenter', () => {
            isRulerVHovered = true;
            rulerV.style.background = 'rgba(30,30,30,0.3)';
            drawRulers();
        });
        rulerV.addEventListener('mouseleave', () => {
            isRulerVHovered = false;
            rulerV.style.background = 'rgba(30,30,30,0.01)';
            drawRulers();
        });

        // Временные гайды при перетаскивании
        let tempGuide = null;
        let isDraggingNewGuide = false;
        let dragStartPos = 0;

        // Создание временного гайда
        function createTempGuide(isHorizontal) {
            const guide = document.createElement('div');
            Object.assign(guide.style, {
                position: 'fixed',
                background: 'rgba(255,200,0,0.7)',
                pointerEvents: 'none',
                zIndex: '2147483647',
                boxShadow: '0 0 8px 2px rgba(255,200,0,0.3)',
            });
            if (isHorizontal) {
                Object.assign(guide.style, {
                    left: '0',
                    width: '100vw',
                    height: '2px',
                });
            } else {
                Object.assign(guide.style, {
                    top: '0',
                    width: '2px',
                    height: '100vh',
                });
            }
            return guide;
        }

        // Обработчики для горизонтальной линейки
        rulerH.addEventListener('mousedown', (e) => {
            isDraggingNewGuide = true;
            dragStartPos = e.clientY;
            tempGuide = createTempGuide(true);
            tempGuide.style.top = dragStartPos + 'px';
            guidesContainer.appendChild(tempGuide);
            document.body.style.cursor = 'ns-resize';
        });

        // Обработчики для вертикальной линейки
        rulerV.addEventListener('mousedown', (e) => {
            isDraggingNewGuide = true;
            dragStartPos = e.clientX;
            tempGuide = createTempGuide(false);
            tempGuide.style.left = dragStartPos + 'px';
            guidesContainer.appendChild(tempGuide);
            document.body.style.cursor = 'ew-resize';
        });

        // Общие обработчики перемещения и отпускания
        window.addEventListener('mousemove', (e) => {
            if (!isDraggingNewGuide || !tempGuide) return;

            if (tempGuide.style.height === '2px') { // Горизонтальный гайд
                tempGuide.style.top = e.clientY + 'px';
            } else { // Вертикальный гайд
                tempGuide.style.left = e.clientX + 'px';
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (!isDraggingNewGuide || !tempGuide) return;

            if (tempGuide.style.height === '2px') { // Горизонтальный гайд
                const y = e.clientY;
                if (y > 24) { // Убедимся, что гайд не создается в области линейки
                    hGuides.push(y);
                }
            } else { // Вертикальный гайд
                const x = e.clientX;
                if (x > 24) { // Убедимся, что гайд не создается в области линейки
                    vGuides.push(x);
                }
            }

            // Очистка
            if (tempGuide.parentNode) {
                tempGuide.parentNode.removeChild(tempGuide);
            }
            tempGuide = null;
            isDraggingNewGuide = false;
            document.body.style.cursor = '';
            
            saveGuides();
            renderGuides();
        });

        // Удаляем старые обработчики клика по линейкам
        rulerH.removeEventListener('click', null);
        rulerV.removeEventListener('click', null);

        // === Гайды ===
        let hGuides = [];
        let vGuides = [];
        // === Прямоугольники ===
        let drawnRects = [];
        let drawingRect = null;
        let drawingStart = null;
        let drawingRectData = null;
        // === Resize state ===
        let resizingRectIdx = null;
        let resizingHandle = null;
        let resizeStart = null;
        // === Move state ===
        let movingRectIdx = null;
        let moveStart = null;
        let moveOrig = null;
        // Восстановление из localStorage
        try {
            const saved = JSON.parse(localStorage.getItem('animatePanelGuides') || '{}');
            if (Array.isArray(saved.h)) hGuides = saved.h;
            if (Array.isArray(saved.v)) vGuides = saved.v;
        } catch {}
        // Контейнер для div-гайдов
        const guidesContainer = document.createElement('div');
        Object.assign(guidesContainer.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            width: '100vw',
            height: '100vh',
            pointerEvents: 'auto',
            zIndex: '2147483647',
        });
        guidesContainer.style.display = 'none';
        document.body.appendChild(guidesContainer);
        // Сохранение
        function saveGuides() {
            localStorage.setItem('animatePanelGuides', JSON.stringify({ h: hGuides, v: vGuides }));
        }
                    // === Цветовая палитра для прямоугольников ===
            let selectedColor = 'rgba(0, 120, 255, 0.25)';
            const colorPalette = document.createElement('div');
            Object.assign(colorPalette.style, {
                position: 'fixed',
                bottom: '10px',
                right: '10px',
                background: 'rgba(0, 0, 0, 0.7)',
                padding: '5px',
                borderRadius: '5px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '5px',
                zIndex: '2147483645',
                maxWidth: '150px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
            });

            const colors = [
                'rgba(255, 0, 0, 0.25)',    // Красный
                'rgba(255, 165, 0, 0.25)',  // Оранжевый
                'rgba(255, 255, 0, 0.25)',  // Жёлтый
                'rgba(0, 128, 0, 0.25)',    // Зелёный
                'rgba(0, 120, 255, 0.25)',  // Синий
                'rgba(128, 0, 128, 0.25)',  // Фиолетовый
                'rgba(0, 0, 0, 0.25)',      // Чёрный
                'rgba(255, 255, 255, 0.25)' // Белый
            ];

            colors.forEach(color => {
                const colorBtn = document.createElement('div');
                Object.assign(colorBtn.style, {
                    width: '25px',
                    height: '25px',
                    background: color,
                    borderRadius: '3px',
                    cursor: 'pointer',
                    border: color === selectedColor ? '2px solid white' : '1px solid #ccc'
                });
                
                colorBtn.addEventListener('click', () => {
                    selectedColor = color;
                    // Обновляем выделение выбранного цвета
                    colorPalette.querySelectorAll('div').forEach(btn => {
                        btn.style.border = btn === colorBtn ? '2px solid white' : '1px solid #ccc';
                    });
                });
                
                colorPalette.appendChild(colorBtn);
            });
            document.body.appendChild(colorPalette);
            colorPalette.style.display = 'none';

            // === Рисование прямоугольников мышкой ===
            rulersOverlay.addEventListener('mousedown', (e) => {
                // Только если клик по guidesContainer (рабочее поле, не ruler, не гайд, не прямоугольник)
                if (e.target === guidesContainer) {
                    guidesContainer.style.pointerEvents = 'auto';
                    // Имитируем mousedown на guidesContainer для старта рисования
                    const evt = new MouseEvent('mousedown', e);
                    guidesContainer.dispatchEvent(evt);
                }
            });
            
            guidesContainer.addEventListener('mousedown', (e) => {
                if (rulersOverlay.style.display === 'none') return;
                if (e.button !== 0) return;
                if (e.target !== guidesContainer) return;
                
                drawingStart = { x: e.clientX, y: e.clientY };
                drawingRectData = { left: drawingStart.x, top: drawingStart.y, width: 1, height: 1, color: selectedColor };
                drawingRect = document.createElement('div');
                Object.assign(drawingRect.style, {
                    position: 'fixed',
                    left: `${drawingRectData.left}px`,
                    top: `${drawingRectData.top}px`,
                    width: `${drawingRectData.width}px`,
                    height: `${drawingRectData.height}px`,
                    border: `1.5px solid #2196f3`,
                    background: drawingRectData.color,
                    zIndex: '2147483648',
                    pointerEvents: 'none',
                    borderRadius: '0px',
                    boxSizing: 'border-box',
                    cursor: 'crosshair',
                });
                guidesContainer.appendChild(drawingRect);
                e.preventDefault();
            });
            
            window.addEventListener('mousemove', (e) => {
                if (!drawingRect || !drawingStart || !drawingRectData) return;
                const x1 = drawingStart.x;
                const y1 = drawingStart.y;
                const x2 = e.clientX;
                const y2 = e.clientY;
                const left = Math.min(x1, x2);
                const top = Math.min(y1, y2);
                const width = Math.abs(x2 - x1);
                const height = Math.abs(y2 - y1);
                Object.assign(drawingRect.style, {
                    left: `${left}px`,
                    top: `${top}px`,
                    width: `${width}px`,
                    height: `${height}px`,
                });
                drawingRectData.left = left;
                drawingRectData.top = top;
                drawingRectData.width = width;
                drawingRectData.height = height;
            });
            
            // Обрабатываем mouseup для создания прямоугольника
            const origWindowMouseUp = window.onmouseup;
            window.addEventListener('mouseup', (e) => {
                if (!drawingRect || !drawingStart || !drawingRectData) return;
                if (drawingRectData.width < 5 || drawingRectData.height < 5) {
                    if (drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
                } else {
                    drawnRects.push({ ...drawingRectData });
                }
                if (drawingRect && drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
                drawingRect = null;
                drawingStart = null;
                drawingRectData = null;
                renderGuides();
                // После любого mouseup возвращаем pointerEvents: 'none' для guidesContainer
                guidesContainer.style.pointerEvents = 'none';
            });

        // === Функция для добавления маркеров изменения размера к прямоугольнику ===
        function addResizeHandles(r, idx) {
            const handles = [
                { pos: 'nw', style: { left: '-4px', top: '-4px', cursor: 'nwse-resize' } },
                { pos: 'n', style: { left: 'calc(50% - 4px)', top: '-4px', cursor: 'ns-resize' } },
                { pos: 'ne', style: { right: '-4px', top: '-4px', cursor: 'nesw-resize' } },
                { pos: 'e', style: { right: '-4px', top: 'calc(50% - 4px)', cursor: 'ew-resize' } },
                { pos: 'se', style: { right: '-4px', bottom: '-4px', cursor: 'nwse-resize' } },
                { pos: 's', style: { left: 'calc(50% - 4px)', bottom: '-4px', cursor: 'ns-resize' } },
                { pos: 'sw', style: { left: '-4px', bottom: '-4px', cursor: 'nesw-resize' } },
                { pos: 'w', style: { left: '-4px', top: 'calc(50% - 4px)', cursor: 'ew-resize' } }
            ];
            
            handles.forEach(h => {
                const handle = document.createElement('div');
                Object.assign(handle.style, {
                    position: 'absolute',
                    width: '8px',
                    height: '8px',
                    background: '#2196f3',
                    border: '1px solid #fff',
                    borderRadius: '0px',
                    zIndex: '2147483649',
                    pointerEvents: 'auto',
                    opacity: '0.8',
                    visibility: 'hidden',
                    ...h.style
                });
                
                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    resizingRectIdx = idx;
                    resizingHandle = h.pos;
                    const rect = drawnRects[idx];
                    
                    resizeStart = {
                        startX: e.clientX,
                        startY: e.clientY,
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height
                    };
                });
                
                r.appendChild(handle);
            });
            
            // Показывать ручки при наведении
            r.addEventListener('mouseenter', () => {
                r.querySelectorAll('div').forEach(handle => {
                    handle.style.visibility = 'visible';
                });
            });
            
            // Скрывать ручки при уходе курсора
            r.addEventListener('mouseleave', () => {
                // Не скрываем ручки если этот прямоугольник изменяется
                if (resizingRectIdx === idx) return;
                
                r.querySelectorAll('div').forEach(handle => {
                    handle.style.visibility = 'hidden';
                });
            });
        }

        // Обновляем функцию renderGuides для создания прямоугольников с расширенной функциональностью
        function renderGuides() {
            guidesContainer.innerHTML = '';
            // Вертикальные
            vGuides.forEach((x, i) => {
                const g = document.createElement('div');
                Object.assign(g.style, {
                    position: 'fixed',
                    left: (x - 5) + 'px',  // Смещаем влево на 5px для увеличения области клика
                    top: '0',
                    width: '10px',  // Увеличенная ширина для удобства клика
                    height: '100vh',
                    background: 'transparent',  // Делаем фон прозрачным
                    zIndex: '2147483647',
                    cursor: 'ew-resize',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    boxShadow: selectedGuides.v.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                
                // Добавляем внутреннюю линию для визуального отображения
                const innerLine = document.createElement('div');
                Object.assign(innerLine.style, {
                    position: 'absolute',
                    left: '4px',  // Центрируем линию в контейнере
                    top: '0',
                    width: '2px',  // Оригинальная ширина линии
                    height: '100%',
                    background: selectedGuides.v.includes(i) ? 'rgba(255,200,0,0.95)' : 'rgba(0,200,255,0.7)',
                    pointerEvents: 'none',  // Линия не мешает кликам
                    boxShadow: selectedGuides.v.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                g.appendChild(innerLine);
                
                g.title = 'Перетащите для перемещения, двойной клик — удалить, клик — выбрать для измерения';
                g.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    draggingGuide = g;
                    dragType = 'v';
                    dragIndex = i;
                    dragStart = e.clientX;
                    dragOrig = x;
                    document.body.style.cursor = 'ew-resize';
                    e.preventDefault();
                });
                g.addEventListener('dblclick', (e) => {
                    vGuides.splice(i, 1);
                    saveGuides();
                    renderGuides();
                    clearDistanceLabel();
                    e.stopPropagation();
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedGuides.v.length === 0) {
                        selectedGuides.v = [i];
                        renderGuides();
                    } else if (selectedGuides.v.length === 1 && selectedGuides.v[0] !== i) {
                        selectedGuides.v.push(i);
                        renderGuides();
                        showDistanceLabel('v', selectedGuides.v[0], selectedGuides.v[1]);
                    } else {
                        clearDistanceLabel();
                        renderGuides();
                    }
                });
                guidesContainer.appendChild(g);
            });
            // Горизонтальные
            hGuides.forEach((y, i) => {
                const g = document.createElement('div');
                Object.assign(g.style, {
                    position: 'fixed',
                    left: '0',
                    top: (y - 5) + 'px',  // Смещаем вверх на 5px для увеличения области клика
                    width: '100vw',  // Увеличенная высота для удобства клика
                    height: '10px',  // Увеличенная высота для удобства клика
                    background: 'transparent',  // Делаем фон прозрачным
                    zIndex: '2147483647',
                    cursor: 'ns-resize',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                    boxShadow: selectedGuides.h.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                
                // Добавляем внутреннюю линию для визуального отображения
                const innerLine = document.createElement('div');
                Object.assign(innerLine.style, {
                    position: 'absolute',
                    left: '0',
                    top: '4px',  // Центрируем линию в контейнере
                    width: '100%',
                    height: '2px',  // Оригинальная высота линии
                    background: selectedGuides.h.includes(i) ? 'rgba(255,200,0,0.95)' : 'rgba(0,200,255,0.7)',
                    pointerEvents: 'none',  // Линия не мешает кликам
                    boxShadow: selectedGuides.h.includes(i) ? '0 0 8px 2px #ffd70099' : '',
                });
                g.appendChild(innerLine);
                
                g.title = 'Перетащите для перемещения, двойной клик — удалить, клик — выбрать для измерения';
                g.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    draggingGuide = g;
                    dragType = 'h';
                    dragIndex = i;
                    dragStart = e.clientY;
                    dragOrig = y;
                    document.body.style.cursor = 'ns-resize';
                    e.preventDefault();
                });
                g.addEventListener('dblclick', (e) => {
                    hGuides.splice(i, 1);
                    saveGuides();
                    renderGuides();
                    clearDistanceLabel();
                    e.stopPropagation();
                });
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (selectedGuides.h.length === 0) {
                        selectedGuides.h = [i];
                        renderGuides();
                    } else if (selectedGuides.h.length === 1 && selectedGuides.h[0] !== i) {
                        selectedGuides.h.push(i);
                        renderGuides();
                        showDistanceLabel('h', selectedGuides.h[0], selectedGuides.h[1]);
                    } else {
                        clearDistanceLabel();
                        renderGuides();
                    }
                });
                guidesContainer.appendChild(g);
            });
            // Прямоугольники
            drawnRects.forEach((rect, idx) => {
                const r = document.createElement('div');
                Object.assign(r.style, {
                    position: 'fixed',
                    left: rect.left + 'px',
                    top: rect.top + 'px',
                    width: rect.width + 'px',
                    height: rect.height + 'px',
                    border: '1.5px solid #2196f3',
                    background: rect.color,
                    zIndex: '2147483648',
                    pointerEvents: 'auto',
                    borderRadius: '0px',
                    boxSizing: 'border-box',
                    outline: (resizingRectIdx === idx) ? '1px solid rgba(33, 150, 243, 0.5)' : (movingRectIdx === idx ? '1px solid rgba(255, 152, 0, 0.5)' : 'none'),
                    userSelect: 'none',
                    overflow: 'visible',
                    cursor: 'grab',
                });
                
                // Удаление по двойному клику
                r.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    drawnRects.splice(idx, 1);
                    renderGuides();
                });
                
                // Перемещение прямоугольника только для копирования с Shift
                r.addEventListener('mousedown', (e) => {
                    // Если клик не на самом прямоугольнике (например, на маркере), игнорируем
                    if (e.target !== r) return;
                    
                    // Если Shift зажат - копируем прямоугольник
                    if (e.shiftKey) {
                        e.stopPropagation();
                        const newRect = { ...rect };
                        newRect.left += 20;
                        newRect.top += 20;
                        drawnRects.push(newRect);
                        renderGuides();
                        return;
                    }
                    
                    // Стандартное перемещение теперь обрабатывается через makeRectDraggable
                });
                
                // Добавляем маркеры для изменения размера
                addResizeHandles(r, idx);
                
                // Добавляем возможность перетаскивания через makeRectDraggable
                makeRectDraggable(r, idx);
                
                guidesContainer.appendChild(r);
            });
            
            // Метки расстояния и временные элементы
            if (distanceLabel) guidesContainer.appendChild(distanceLabel);
            if (drawingRect && drawingRect.parentNode == null) {
                guidesContainer.appendChild(drawingRect);
            }
        }

        // Сброс выбора при клике вне гайдов
        guidesContainer.addEventListener('click', (e) => {
            clearDistanceLabel();
            renderGuides();
        });
        window.addEventListener('mousemove', (e) => {
            // === RESIZE RECT ===
            if (resizingRectIdx !== null && resizingHandle !== null && resizeStart) {
                const rect = drawnRects[resizingRectIdx];
                let dx = e.clientX - resizeStart.startX;
                let dy = e.clientY - resizeStart.startY;
                let newRect = Object.assign({}, rect);
                if (resizingHandle === 'nw') {
                    newRect.left = resizeStart.left + dx;
                    newRect.top = resizeStart.top + dy;
                    newRect.width = resizeStart.width - dx;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'ne') {
                    newRect.top = resizeStart.top + dy;
                    newRect.width = resizeStart.width + dx;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'sw') {
                    newRect.left = resizeStart.left + dx;
                    newRect.width = resizeStart.width - dx;
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'se') {
                    newRect.width = resizeStart.width + dx;
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'n') {
                    newRect.top = resizeStart.top + dy;
                    newRect.height = resizeStart.height - dy;
                } else if (resizingHandle === 'e') {
                    newRect.width = resizeStart.width + dx;
                } else if (resizingHandle === 's') {
                    newRect.height = resizeStart.height + dy;
                } else if (resizingHandle === 'w') {
                    newRect.left = resizeStart.left + dx;
                    newRect.width = resizeStart.width - dx;
                }
                // Минимальный размер
                if (newRect.width < 10) newRect.width = 10;
                if (newRect.height < 10) newRect.height = 10;
                drawnRects[resizingRectIdx] = newRect;
                renderGuides();
                return;
            }
            // === DRAG GUIDE ===
            if (draggingGuide) {
                if (dragType === 'v') {
                    let nx = dragOrig + (e.clientX - dragStart);
                    nx = Math.max(0, Math.min(window.innerWidth - 1, nx));
                    vGuides[dragIndex] = nx;
                } else if (dragType === 'h') {
                    let ny = dragOrig + (e.clientY - dragStart);
                    ny = Math.max(0, Math.min(window.innerHeight - 1, ny));
                    hGuides[dragIndex] = ny;
                }
                renderGuides();
                clearDistanceLabel();
                return;
            }
            // ... остальные действия (например, рисование прямоугольника) ...
        });
        window.addEventListener('mouseup', (e) => {
            // === RESIZE RECT ===
            if (resizingRectIdx !== null) {
                resizingRectIdx = null;
                resizingHandle = null;
                resizeStart = null;
                return;
            }
            if (draggingGuide) {
                saveGuides();
                draggingGuide = null;
                dragType = null;
                dragIndex = -1;
                document.body.style.cursor = '';
            }
        });
        // Перерисовка линеек
        function drawRulers() {
            // Горизонтальная
            rulerH.width = window.innerWidth;
            rulerH.height = 24;
            const ctxH = rulerH.getContext('2d');
            ctxH.clearRect(0, 0, rulerH.width, rulerH.height);
            
            // Используем булевую переменную вместо сравнения строк
            
            // Выбираем цвет линий и текста в зависимости от наведения
            ctxH.fillStyle = isRulerHHovered ? 'rgba(34,34,34,0.3)' : 'rgba(34,34,34,0.01)';
            ctxH.fillRect(0, 0, rulerH.width, 24);
            ctxH.strokeStyle = isRulerHHovered ? 'rgba(120,120,120,0.8)' : 'rgba(170,170,170,0.03)';
            
            for (let x = 0; x < rulerH.width; x += 10) {
                ctxH.beginPath();
                ctxH.moveTo(x + 0.5, 24);
                ctxH.lineTo(x + 0.5, x % 100 === 0 ? 4 : (x % 50 === 0 ? 10 : 16));
                ctxH.stroke();
                if (x % 50 === 0) {
                    ctxH.fillStyle = isRulerHHovered ? 'rgba(255,255,255,0.8)' : 'rgba(170,170,170,0.03)';
                    ctxH.font = 'bold 10px Arial';
                    ctxH.fillText(x.toString(), x + 2, 12);
                }
            }
            
            // Вертикальная
            rulerV.width = 24;
            rulerV.height = window.innerHeight;
            const ctxV = rulerV.getContext('2d');
            ctxV.clearRect(0, 0, 24, rulerV.height);
            
            // Используем булевую переменную вместо сравнения строк
            
            // Выбираем цвет линий и текста в зависимости от наведения
            ctxV.fillStyle = isRulerVHovered ? 'rgba(34,34,34,0.3)' : 'rgba(34,34,34,0.01)';
            ctxV.fillRect(0, 0, 24, rulerV.height);
            ctxV.strokeStyle = isRulerVHovered ? 'rgba(120,120,120,0.8)' : 'rgba(170,170,170,0.03)';
            
            for (let y = 0; y < rulerV.height; y += 10) {
                ctxV.beginPath();
                ctxV.moveTo(24, y + 0.5);
                ctxV.lineTo(y % 100 === 0 ? 4 : (y % 50 === 0 ? 10 : 16), y + 0.5);
                ctxV.stroke();
                if (y % 50 === 0) {
                    ctxV.fillStyle = isRulerVHovered ? 'rgba(255,255,255,0.8)' : 'rgba(170,170,170,0.03)';
                    ctxV.font = 'bold 10px Arial';
                    ctxV.fillText(y.toString(), 2, y + 10);
                }
            }
            
            // Рисуем вертикальные гайды на rulerH
            ctxH.strokeStyle = '#00eaff';
            vGuides.forEach(x => {
                ctxH.beginPath();
                ctxH.moveTo(x + 0.5, 0);
                ctxH.lineTo(x + 0.5, 24);
                ctxH.stroke();
            });
            
            // Рисуем горизонтальные гайды на rulerV
            ctxV.strokeStyle = '#00eaff';
            hGuides.forEach(y => {
                ctxV.beginPath();
                ctxV.moveTo(0, y + 0.5);
                ctxV.lineTo(24, y + 0.5);
                ctxV.stroke();
            });
        }
        window.addEventListener('resize', () => {
            drawRulers();
            renderGuides();
        });
        // Показывать/скрывать guidesContainer вместе с rulersOverlay
        rulersBtn.addEventListener('click', () => {
            if (rulersOverlay.style.display === 'none') {
                rulersOverlay.style.display = 'block';
                guidesContainer.style.display = 'block';
                guidesContainer.style.pointerEvents = 'auto';
                drawRulers();
                renderGuides();
                
                // Активируем режим редактирования баннера
                window.isRulersActive = true;
                window.isBannerEditModeActive = true;
                
                // Обновляем цвет кнопки
                updateRulersBtnColor();
            } else {
                rulersOverlay.style.display = 'none';
                guidesContainer.style.display = 'none';
                guidesContainer.style.pointerEvents = 'none';
                
                // Деактивируем режим линеек
                window.isRulersActive = false;
                // Проверяем, остался ли активным режим изменения ширины
                window.isBannerEditModeActive = window.isWidthControlActive === true;
                
                // Обновляем цвет кнопки
                updateRulersBtnColor();
            }
        });

        panel.appendChild(btnContainer);
        document.body.appendChild(panel);

        // === Создаем информационную панель внизу браузера ===
        const statusBar = document.createElement('div');
        Object.assign(statusBar.style, {
            position: 'fixed',
            left: '0',
            bottom: '0',
            width: '100%',
            height: '24px',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px',
            fontFamily: 'Arial, sans-serif',
            fontSize: '12px',
            fontWeight: 'bold',
            zIndex: '9998',
            userSelect: 'none',
            transition: 'opacity 0.3s',
            boxShadow: '0 -1px 3px rgba(0,0,0,0.2)',
        });
        document.body.appendChild(statusBar);

        // Создаем разделы информационной панели
        const infoSections = {};
        const sectionIds = ['bannerSize', 'cursorPosition', 'fps', 'frameInfo', 'windowSize'];
        
        sectionIds.forEach(id => {
            const section = document.createElement('div');
            Object.assign(section.style, {
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                height: '100%',
                borderLeft: id !== 'bannerSize' ? '1px solid rgba(255,255,255,0.1)' : 'none',
            });
            
            // Добавляем иконки для разных секций
            let icon = '';
            let label = '';
            
            switch(id) {
                case 'bannerSize':
                    icon = 'aspect_ratio';
                    label = 'Баннер:';
                    break;
                case 'cursorPosition':
                    icon = 'mouse';
                    label = 'Курсор:';
                    break;
                case 'fps':
                    icon = 'speed';
                    label = 'FPS:';
                    break;
                case 'frameInfo':
                    icon = 'videocam';
                    label = 'Кадр:';
                    break;
                case 'windowSize':
                    icon = 'desktop_windows';
                    label = 'Окно:';
                    break;
            }
            
            // Создаем иконку
            if (icon) {
                const iconElement = document.createElement('span');
                iconElement.className = 'material-icons';
                iconElement.textContent = icon;
                iconElement.style.fontSize = '14px';
                iconElement.style.marginRight = '4px';
                iconElement.style.opacity = '0.8';
                section.appendChild(iconElement);
            }
            
            // Создаем метку
            if (label) {
                const labelElement = document.createElement('span');
                labelElement.textContent = label;
                labelElement.style.marginRight = '5px';
                labelElement.style.fontSize = '11px';
                labelElement.style.opacity = '0.7';
                section.appendChild(labelElement);
            }
            
            // Создаем элемент для данных
            const valueElement = document.createElement('span');
            valueElement.textContent = '-';
            section.appendChild(valueElement);
            
            statusBar.appendChild(section);
            infoSections[id] = {section, value: valueElement};
        });

        // Функции обновления данных
        
        // Обновление размера баннера
        function updateBannerSize() {
            const container = document.getElementById('animation_container');
            if (container && infoSections.bannerSize) {
                const w = container.offsetWidth;
                const h = container.offsetHeight;
                infoSections.bannerSize.value.textContent = `${w}×${h}px`;
            } else if (infoSections.bannerSize) {
                infoSections.bannerSize.value.textContent = '-';
            }
        }
        
        // Обновление позиции курсора
        function updateCursorPosition(e) {
            if (infoSections.cursorPosition) {
                infoSections.cursorPosition.value.textContent = `${e.clientX}, ${e.clientY}`;
            }
        }
        
        // Обновление FPS
        function updateFpsInfo() {
            if (infoSections.fps && typeof createjs !== 'undefined' && createjs.Ticker) {
                infoSections.fps.value.textContent = Math.round(createjs.Ticker.framerate);
            } else if (infoSections.fps) {
                infoSections.fps.value.textContent = '-';
            }
        }
        
        // Обновление информации о кадре
        function updateFrameInfo() {
            if (infoSections.frameInfo && typeof window.exportRoot !== 'undefined') {
                let currentFrame = 0;
                let totalFrames = 0;
                
                if (typeof window.exportRoot.currentFrame === 'number') {
                    currentFrame = window.exportRoot.currentFrame;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.position === 'number') {
                    currentFrame = window.exportRoot.timeline.position;
                }
                
                if (typeof window.exportRoot.totalFrames === 'number') {
                    totalFrames = window.exportRoot.totalFrames;
                } else if (window.exportRoot.timeline && typeof window.exportRoot.timeline.duration === 'number') {
                    totalFrames = window.exportRoot.timeline.duration;
                }
                
                infoSections.frameInfo.value.textContent = `${Math.round(currentFrame) + 1}/${totalFrames}`;
            } else if (infoSections.frameInfo) {
                infoSections.frameInfo.value.textContent = '-';
            }
        }
        
        // Обновление размера окна
        function updateWindowSize() {
            if (infoSections.windowSize) {
                infoSections.windowSize.value.textContent = `${window.innerWidth}×${window.innerHeight}px`;
            }
        }
        
        // Регистрируем обработчики событий
        window.addEventListener('mousemove', updateCursorPosition);
        window.addEventListener('resize', () => {
            updateBannerSize();
            updateWindowSize();
        });
        
        // Инициализация и регулярное обновление
        updateBannerSize();
        updateWindowSize();
        setInterval(() => {
            updateBannerSize();
            updateFpsInfo();
            updateFrameInfo();
        }, 250);
        
        // Таймауты для надежного обновления после загрузки
        setTimeout(updateBannerSize, 1000);
        setTimeout(updateBannerSize, 3000);
        
        // Автоскрытие статусной панели при бездействии
        let statusBarHideTimeout;
        
        function resetStatusBarTimeout() {
            clearTimeout(statusBarHideTimeout);
            statusBar.style.opacity = '1';
            statusBarHideTimeout = setTimeout(() => {
                statusBar.style.opacity = '0.1';
            }, 5000);
        }
        
        window.addEventListener('mousemove', resetStatusBarTimeout);
        statusBar.addEventListener('mouseenter', () => {
            clearTimeout(statusBarHideTimeout);
            statusBar.style.opacity = '1';
        });
        statusBar.addEventListener('mouseleave', resetStatusBarTimeout);
        
        resetStatusBarTimeout();

        // Вспомогательные функции для drag и выбора
        let draggingGuide = null;
        let dragType = null; // 'h' | 'v'
        let dragIndex = -1;
        let dragStart = 0;
        let dragOrig = 0;
        // Для выбора двух гайдов и отображения расстояния
        let selectedGuides = { h: [], v: [] };
        let distanceLabel = null;
        function clearDistanceLabel() {
            if (distanceLabel && distanceLabel.parentNode) distanceLabel.parentNode.removeChild(distanceLabel);
            distanceLabel = null;
            selectedGuides = { h: [], v: [] };
        }
        function showDistanceLabel(type, idx1, idx2) {
            clearDistanceLabel();
            if (type !== 'h' && type !== 'v') return;
            let pos1 = (type === 'h' ? hGuides[idx1] : vGuides[idx1]);
            let pos2 = (type === 'h' ? hGuides[idx2] : vGuides[idx2]);
            let d = Math.abs(pos2 - pos1);
            // Создаём метку
            distanceLabel = document.createElement('div');
            distanceLabel.textContent = d + ' px';
            Object.assign(distanceLabel.style, {
                position: 'fixed',
                zIndex: '2147483648',
                background: 'rgba(0,0,0,0.85)',
                color: '#fff',
                fontSize: '13px',
                padding: '2px 8px',
                borderRadius: '6px',
                pointerEvents: 'none',
                fontWeight: 'bold',
                boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                userSelect: 'none',
                letterSpacing: '0.5px',
            });
            if (type === 'v') {
                // Вертикальные: метка по центру между x1 и x2, сверху
                let x = (pos1 + pos2) / 2;
                distanceLabel.style.left = (x - 24) + 'px';
                distanceLabel.style.top = '28px';
            } else {
                // Горизонтальные: метка по центру между y1 и y2, слева
                let y = (pos1 + pos2) / 2;
                distanceLabel.style.left = '32px';
                distanceLabel.style.top = (y - 12) + 'px';
            }
            guidesContainer.appendChild(distanceLabel);
        }

        // Функция для добавления возможности перетаскивания прямоугольника
        function makeRectDraggable(element, idx) {
            let isDragging = false;
            let offsetX, offsetY;
            
            // Заменяем глобальный слушатель, добавляем прослушивание только на сам элемент
            element.addEventListener('mousedown', (e) => {
                // Если клик не на самом прямоугольнике (например, на маркере), игнорируем
                if (e.target !== element) return;
                
                // Если Shift зажат - копируем прямоугольник (эта функциональность уже реализована в обработчике)
                if (e.shiftKey) return;
                
                // Проверяем, не перемещаем ли мы уже этот прямоугольник через другой механизм
                if (movingRectIdx === idx) return;
                
                // Обычное перемещение
                isDragging = true;
                offsetX = e.clientX - parseInt(element.style.left);
                offsetY = e.clientY - parseInt(element.style.top);
                
                // Добавляем визуальную обратную связь
                element.style.cursor = 'move';
                e.stopPropagation(); // Предотвращаем создание нового прямоугольника
            });
            
            const moveHandler = (e) => {
                if (isDragging) {
                    const newLeft = e.clientX - offsetX;
                    const newTop = e.clientY - offsetY;
                    
                    // Обновляем DOM элемент
                    element.style.left = `${newLeft}px`;
                    element.style.top = `${newTop}px`;
                    
                    // Синхронизируем с данными в массиве прямоугольников
                    if (drawnRects[idx]) {
                        drawnRects[idx].left = newLeft;
                        drawnRects[idx].top = newTop;
                    }
                    
                    e.preventDefault();
                }
            };
            
            const upHandler = () => {
                if (isDragging) {
                    isDragging = false;
                    element.style.cursor = 'grab';
                }
            };
            
            // Используем capture фазу для событий
            document.addEventListener('mousemove', moveHandler, true);
            document.addEventListener('mouseup', upHandler, true);
            
            // Удаляем слушателей при удалении из DOM
            element.addEventListener('remove', () => {
                document.removeEventListener('mousemove', moveHandler, true);
                document.removeEventListener('mouseup', upHandler, true);
            });
        }
    }

    window.addEventListener('load', () => {
        waitForCreatejsTickerAndInitPanel();
    });
})();
