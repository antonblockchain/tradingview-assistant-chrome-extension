/*
 @license Copyright 2021 akumidv (https://github.com/akumidv/)
 SPDX-License-Identifier: Apache-2.0
*/

'use strict';

(async function() {
  // GLOBALS
  // SEL  "content_scripts/selector.js"
  // page  "content_scripts/page.js"
  // tv  "content_scripts/tv.js"

  const DEF_MAX_PARAM_NAME = 'Net Profit All'


  let isReportChanged = false

  let isMsgShown = false
  let tickerTextPrev = null
  let timeFrameTextPrev = null

  setInterval(ui.checkInjectedElements, 1000);

  chrome.runtime.onMessage.addListener(
    async function(request, sender, reply) {
      if(sender.tab || !request.hasOwnProperty('action') || !request.action) {
        console.log('Not for action message received:', request)
        return
      }
      if(action.workerStatus !== null) {
        console.log('Waiting for end previous work. Status:', action.workerStatus)
        return
      }

      action.workerStatus = request.action
      try {
        switch (request.action) {
        //   case 'saveParameters': {
        //     await action.saveParameters()
        //     break;
        //   }
        //   case 'loadParameters': {
        //     await action.loadParameters()
        //     break;
        //   }
          case 'uploadSignals': {
            await file.upload(parseTSSignalsAndGetMsg, `Please check if the ticker and timeframe are set like in the downloaded data and click on the parameters of the "iondvSignals" script to automatically enter new data on the chart.`, true)
            break;
          }
          case 'uploadStrategyTestParameters': {
            await file.upload(parseStrategyParamsAndGetMsg, '', false)
            break;
          }
          case 'getStrategyTemplate': {
            const strategyData = await tv.getStrategy()
            if(!strategyData || !strategyData.hasOwnProperty('name') || !strategyData.hasOwnProperty('properties') || !strategyData.properties) {
              alert('It was not possible to find a strategy with parameters among the indicators. Add it to the chart and try again.')
            } else {
              const paramRange = model.getStrategyRange(strategyData)
              console.log(paramRange)
              // await storage.setKeys(storage.STRATEGY_KEY_PARAM, paramRange)
              const strategyRangeParamsCSV = strategyRangeToTemplate(paramRange)
              file.saveAs(strategyRangeParamsCSV, `${strategyData.name}.csv`)
              alert('The range of parameters is saved for the current strategy.\n\nYou can start optimizing the strategy parameters by clicking on the "Test strategy" button')
            }
            break;
          }
          case 'testStrategy': {
            console.log('request', request)
            statusMessage('Get the initial parameters.')
            const strategyData = await tv.getStrategy()
            if(!strategyData || !strategyData.hasOwnProperty('name') || !strategyData.hasOwnProperty('properties') || !strategyData.properties) {
              alert('It was not possible to find a strategy with parameters among the indicators. Add it to the chart and try again.')
              break
            }
            const paramRange = await model.getStrategyParameters(strategyData)
            console.log('paramRange', paramRange)
            if(!paramRange)
              break
            const allRangeParams = createParamsFormRange(paramRange)
            console.log('allRangeParams', allRangeParams)
            if(!allRangeParams) {
              break
            }

            const testMethod = request.options.optMethod ? request.options.optMethod.toLowerCase() : 'random'
            let paramSpaceNumber = 0
            let isSequential = false
            if(['sequential'].includes(testMethod)) {
              paramSpaceNumber = Object.keys(allRangeParams).reduce((sum, param) => sum += allRangeParams[param].length, 0)
              isSequential = true
            } else {
              paramSpaceNumber = Object.keys(allRangeParams).reduce((mult, param) => mult *= allRangeParams[param].length, 1)
            }
            console.log('paramSpaceNumber', paramSpaceNumber)

            let testParams = await tv.switchToStrategyTab()
            if(!testParams)
              break

            let paramPriority = getParamPriorityList(paramRange) // Filter by allRangeParams
            paramPriority = paramPriority.filter(key => allRangeParams.hasOwnProperty(key))
            console.log('paramPriority list', paramPriority)
            testParams.paramPriority = paramPriority

            testParams.startParams = await getStartParamValues(paramRange, strategyData)
            console.log('testParams.startParams', testParams.startParams)
            if(!testParams.hasOwnProperty('startParams') || !testParams.startParams.hasOwnProperty('current') || !testParams.startParams.current) {
              alert('Error.\n\n The current strategy parameters could not be determined.\n Testing aborted')
              break
            }

            if(isSequential) {
              alert(`For ${testMethod} testing, the number of ${paramSpaceNumber} cycles is automatically determined, which is equal to the size of the parameter space.\n\nYou can interrupt the search for strategy parameters by just reloading the page and at the same time, you will not lose calculations. All data are stored in the storage after each iteration.\nYou can download last test results by clicking on the "Download results" button until you launch new strategy testing.`, 100)
              testParams.cycles = paramSpaceNumber
            } else {
              const cyclesStr = prompt(`Please enter the number of cycles for optimization.\n\nYou can interrupt the search for strategy parameters by just reloading the page and at the same time, you will not lose calculations. All data are stored in the storage after each iteration.\nYou can download last test results by clicking on the "Download results" button until you launch new strategy testing.`, 100)
              if(!cyclesStr)
                break
              let cycles = parseInt(cyclesStr)
              if(!cycles || cycles < 1)
                break
              testParams.cycles = cycles
            }


            if(request.options) {
              testParams.isMaximizing = request.options.hasOwnProperty('isMaximizing') ? request.options.isMaximizing : true
              testParams.optParamName =  request.options.optParamName ? request.options.optParamName : DEF_MAX_PARAM_NAME
              testParams.method = testMethod
              testParams.filterAscending = request.options.hasOwnProperty('optFilterAscending') ? request.options.optFilterAscending : null
              testParams.filterValue = request.options.hasOwnProperty('optFilterValue') ? request.options.optFilterValue : 50
              testParams.filterParamName = request.options.hasOwnProperty('optFilterParamName') ? request.options.optFilterParamName : 'Total Closed Trades: All'
            }


            let extraHeader = `The search is performed among ${paramSpaceNumber} possible combinations of parameters (space).`
            extraHeader += (paramSpaceNumber/testParams.cycles) > 10 ? `<br />This is too large for ${testParams.cycles} cycles. It is recommended to use up to 3-4 essential parameters, remove the rest from the strategy parameters file.` : ''

            statusMessage('Started.', extraHeader)
             const testResults = await testStrategy(testParams, strategyData, allRangeParams)
            console.log('testResults', testResults)
            if(!testResults.perfomanceSummary && !testResults.perfomanceSummary.length) {
              alert('There is no data for conversion. Try to do test again')
              break
            }

            const CSVResults = convertResultsToCSV(testResults)
            const bestResult = testResults.perfomanceSummary ? getBestResult(testResults) : {}
            const initBestValue = testResults.hasOwnProperty('initBestValue') ? testResults.initBestValue : null
            const propVal = {}
            testResults.paramsNames.forEach(paramName => {
              if(bestResult.hasOwnProperty(`__${paramName}`))
                propVal[paramName] = bestResult[`__${paramName}`]
            })
            await tv.setStrategyParams(testResults.shortName, propVal)
            let text = `All done.\n\n`
            text += bestResult && bestResult.hasOwnProperty(testParams.optParamName) ? 'The best '+ (testResults.isMaximizing ? '(max) ':'(min) ') + testParams.optParamName + ': ' + bestResult[testParams.optParamName] : ''
            text += (initBestValue !== null && bestResult && bestResult.hasOwnProperty(testParams.optParamName) && initBestValue === bestResult[testParams.optParamName]) ? `\nIt isn't improved from the initial value: ${initBestValue}` : ''
            statusMessage(text)
            alert(text)
            console.log(`All done.\n\n${bestResult && bestResult.hasOwnProperty(testParams.optParamName) ? 'The best ' + (testResults.isMaximizing ? '(max) ':'(min) ')  + testParams.optParamName + ': ' + bestResult[testParams.optParamName] : ''}`)
            file.saveAs(CSVResults, `${testResults.ticker}:${testResults.timeFrame} ${testResults.shortName} - ${testResults.cycles}_${testResults.isMaximizing ? 'max':'min'}_${testResults.optParamName}_${testResults.method}.csv`)
            statusMessageRemove()
            break;
          }
          case 'downloadStrategyTestResults': {
            const testResults = await storage.getKey(storage.STRATEGY_KEY_RESULTS)
            if(!testResults || (!testResults.perfomanceSummary && !testResults.perfomanceSummary.length)) {
              alert('There is no data for conversion. Try to do test again')
              break
            }
            testResults.optParamName = testResults.optParamName || DEF_MAX_PARAM_NAME
            console.log('testResults', testResults)
            const CSVResults = convertResultsToCSV(testResults)
            const bestResult = testResults.perfomanceSummary ? getBestResult(testResults) : {}
            const propVal = {}
            testResults.paramsNames.forEach(paramName => {
              if(bestResult.hasOwnProperty(`__${paramName}`))
                propVal[paramName] = bestResult[`__${paramName}`]
            })
            await tv.setStrategyParams(testResults.shortName, propVal)
            if(bestResult && bestResult.hasOwnProperty(testResults.optParamName))
              alert(`The best found parameters are set for the strategy\n\nThe best ${testResults.isMaximizing ? '(max) ':'(min)'} ${testResults.optParamName}: ` + bestResult[testResults.optParamName])
            file.saveAs(CSVResults, `${testResults.ticker}:${testResults.timeFrame} ${testResults.shortName} - ${testResults.cycles}_${testResults.isMaximizing ? 'max':'min'}_${testResults.optParamName}_${testResults.method}.csv`)
            break
          }
          case 'clearAll': {
            const clearRes = await storage.clearAll()
            alert(clearRes && clearRes.length ? `The data was deleted: \n${clearRes.map(item => '- ' + item).join('\n')}` : 'There was no data in the storage')
            break
          }
          default:
            console.log('None of realisation for signal:', request)
        }
      } catch (err) {
        console.error(err)
        alert(`An error has occurred.\n\nReload the page and try again.\nYou can describe the problem by following the link https://github.com/akumidv/tradingview-assistant-chrome-extension/.\n\nError message: ${err.message}`)
      }
      action.workerStatus = null
      statusMessageRemove()
    }
  );

  function getBestResult(testResults) {
    const perfomanceSummary = testResults.perfomanceSummary
    const checkField = testResults.optParamName || DEF_MAX_PARAM_NAME
    const isMaximizing = testResults.hasOwnProperty('isMaximizing') ?  testResults.isMaximizing : true
    if(!perfomanceSummary || !perfomanceSummary.length)
      return ''
    const bestResult = perfomanceSummary.reduce((curBestRes, curResult) => {
      if(curResult.hasOwnProperty(checkField)) {
        if(isMaximizing && (!curBestRes || !curBestRes[checkField] || curBestRes[checkField] < curResult[checkField]))
          return curResult
        else if (!isMaximizing && (!curBestRes || !curBestRes[checkField] || curBestRes[checkField] > curResult[checkField]))
          return curResult
      }
      return curBestRes
    })
    return bestResult
  }

  function autoCloseAlert(msg, duration = 2000) {
    console.log('autoCloseAlert')
    const altEl = document.createElement("div");
    altEl.setAttribute("style","background-color: #ffeaa7;color:black; width: 450px;height: 300px;position: absolute;top:0;bottom:0;left:0;right:0;margin:auto;border: 1px solid black;font-family:arial;font-size:25px;font-weight:bold;display: flex; align-items: center; justify-content: center; text-align: center;");
    altEl.setAttribute("id","iondvAlert");
    altEl.innerHTML = msg;
    setTimeout(function() {
      altEl.parentNode.removeChild(altEl);
    }, duration);
    document.body.appendChild(altEl);
  }

  function statusMessage(msgText, extraHeader = null) {
    const isStatusPresent = document.getElementById('iondvStatus')
    const mObj = isStatusPresent ? document.getElementById('iondvStatus') : document.createElement("div");
    let msgEl
    if(!isStatusPresent) {
       mObj.id = "iondvStatus";
       mObj.setAttribute("style","background-color:rgba(0, 0, 0, 0.2);" +
        "position:absolute;" +
        "width:100%;" +
        "height:100%;" +
        "top:0px;" +
        "left:0px;" +
        "z-index:10000;");
      mObj.style.height = document.documentElement.scrollHeight + "px";
      msgEl = mObj.appendChild(document.createElement("div"));
      msgEl.setAttribute("style","background-color: #fffde0;" +
        "color: black;" +
        "width: 800px;" +
        "height: 175px;" +
        "position: fixed;" +
        "top: 50px;" +
        "right: 0;" +
        "left: 0;" +
        "margin: auto;" +
        "border: 1px solid lightblue;" +
        "box-shadow: 3px 3px 7px #777;" +
        // "display: flex;" +
        "align-items: center; " +
        "justify-content: left; " +
        "text-align: left;");
    } else {
      msgEl = mObj.querySelector('div')
    }
    if(isStatusPresent && msgEl && document.getElementById('iondvMsg') && !extraHeader) {
      document.getElementById('iondvMsg').innerHTML = msgText
    } else {
      extraHeader = extraHeader !== null ? `<div style="font-size: 12px;margin-left: 5px;margin-right: 5px;text-align: left;">${extraHeader}</div>` : '' //;margin-bottom: 10px
      msgEl.innerHTML = '<a id="iondvBoxClose" style="float:right;margin-top:-10px;margin-right:-10px;cursor:pointer;color: #fff;border: 1px solid #AEAEAE;border-radius: 24px;background: #605F61;font-size: 25px;display: inline-block;line-height: 0px;padding: 11px 3px;">x</a>' +
        '<div style="color: blue;font-size: 26px;margin: 5px 5px;text-align: center;">Attention!</div>' +
        '<div style="font-size: 18px;margin-left: 5px;margin-right: 5px;text-align: center;">The page elements are controlled by the browser extension. Please do not click on the page elements. You can reload the page to stop it.</div>' +
        extraHeader +
        '<div id="iondvMsg" style="margin: 5px 10px">' +
        msgText + '</div>';
    }
    if(!isStatusPresent) {
        const tvDialog = document.getElementById('overlap-manager-root')
        if(tvDialog)
          document.body.insertBefore(mObj, tvDialog) // For avoid problem if msg overlap tv dialog window
        else
          document.body.appendChild(mObj);
    }
    const btnClose = document.getElementById('iondvBoxClose')
        if(btnClose) {
          btnClose.onclick = () => {
            console.log('Stop clicked')
            action.workerStatus = null
          }
    }
  }

  function statusMessageRemove() {
    const statusMessageEl = document.getElementById('iondvStatus')
    if(statusMessageEl)
      statusMessageEl.parentNode.removeChild(statusMessageEl)
  }

  function convertResultsToCSV(testResults) {
    if(!testResults || !testResults.perfomanceSummary || !testResults.perfomanceSummary.length)
      return 'There is no data for conversion'
    let headers = Object.keys(testResults.perfomanceSummary[0]) // The first test table can be with error and can't have rows with previous values when parsedReport
    if(testResults.hasOwnProperty('paramsNames') && headers.length <= (Object.keys(testResults.paramsNames).length + 1)) { // Find the another header if only params names and 'comment' in headers
      const headersAll = testResults.perfomanceSummary.find(report => Object.keys(report).length > headers.length)
      if(headersAll)
        headers = Object.keys(headersAll)
    }

    let csv = headers.map(header => JSON.stringify(header)).join(',')
    csv += '\n'
    // testResults.paramsNames.forEach(paramName => csv.replace(`__${paramName}`, paramName)) // TODO isFirst? or leave it as it is
    testResults.perfomanceSummary.forEach(row => {
      const rowData = headers.map(key => typeof row[key] !== 'undefined' ? JSON.stringify(row[key]) : '')
      csv += rowData.join(',').replaceAll('\\"', '""')
      csv += '\n'
    })
    if(testResults.filteredSummary && testResults.filteredSummary.length) {
      csv += headers.map(key => key !== 'comment' ? '' : 'Bellow filtered results of tests') // Empty line
      csv += '\n'
      testResults.filteredSummary.forEach(row => {
        const rowData = headers.map(key => typeof row[key] !== 'undefined' ? JSON.stringify(row[key]) : '')
        csv += rowData.join(',').replaceAll('\\"', '""')
        csv += '\n'
      })
    }
    return csv
  }

  function randomInteger (min = 0, max = 10) {
    return Math.floor( min + Math.random() * (max + 1 - min))
  }

  function randomNormalDistribution(min, max) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) return randomNormalDistribution() // resample between 0 and 1
    else{
      num *= max - min // Stretch to fill range
      num += min // offset to min
    }
    return num
  }
  function parseReportTable() {
    const strategyHeaders = []
    const allHeadersEl = document.querySelectorAll(SEL.strategyReportHeader)
    for(let headerEl of allHeadersEl) {
      if(headerEl)
        strategyHeaders.push(headerEl.innerText)
    }

    const report = {}
    const allReportRowsEl = document.querySelectorAll(SEL.strategyReportRow)
    for(let rowEl of allReportRowsEl) {
      if(rowEl) {
        const allTdEl = rowEl.querySelectorAll('td')
        if(!allTdEl || allTdEl.length < 2 || !allTdEl[0]) {
          console.log(allTdEl[0].innerText)
          continue
        }
        let paramName = allTdEl[0].innerText
        for(let i = 1; i < allTdEl.length; i++) {
          let values = allTdEl[i].innerText
          if(values && typeof values === 'string' && values.trim() && strategyHeaders[i]) {
            values = values.replace(' ', ' ').trim()
            const digitOfValues = values.match(/-?\d+\.?\d*/)
            if(values.includes('\n') && (values.endsWith('%') || values.includes('N/A'))) {
              const valuesPair = values.split('\n', 2)
              if(valuesPair && valuesPair.length == 2) {
                const digitVal0 = valuesPair[0].match(/-?\d+\.?\d*/)
                const digitVal1 = valuesPair[1].match(/-?\d+\.?\d*/)
                report[`${paramName}: ${strategyHeaders[i]}`] = Boolean(digitVal0) ? parseFloat(digitVal0[0]) : valuesPair[0]
                report[`${paramName}: ${strategyHeaders[i]} %`] = Boolean(digitVal1) ? parseFloat(digitVal1[0]) : valuesPair[0]
                continue
              }
            } else if(digitOfValues)
              report[`${paramName}: ${strategyHeaders[i]}`] = parseFloat(digitOfValues)
            else
              report[`${paramName}: ${strategyHeaders[i]}`] = values
          }
        }
      }
    }
    return report
  }

  function calculateAdditionValuesToReport(report) {
    if(!report.hasOwnProperty('Percent Profitable: All') || !typeof report['Percent Profitable: All']  === 'number' ||
      !report.hasOwnProperty('Ratio Avg Win / Avg Loss: All') || !typeof report['Ratio Avg Win / Avg Loss: All']  === 'number')
      return report
    // report['.Reward'] = report['Ratio Avg Win / Avg Loss: All'] * 100

    // TODO
    return report
  }

  async function getTestIterationResult (testResults, propVal, isIgnoreError = false) {
    let reportData = {}
    isReportChanged = false // Global value
    const isParamsSet = await tv.setStrategyParams(testResults.shortName, propVal)
    if(!isParamsSet)
      return {error: 1, errMessage: 'The strategy parameters cannot be set', data: null}

    let isProcessStart = await page.waitForSelector(SEL.strategyReportInProcess, 1500)
    let isProcessEnd = isReportChanged

    if (isProcessStart)
      isProcessEnd = await page.waitForSelector(SEL.strategyReportReady, 30000) // TODO to options
    else if (isProcessEnd)
      isProcessStart = true

    let isProcessError = document.querySelector(SEL.strategyReportError)
    await page.waitForTimeout(150) // Waiting for update digits. 150 is enough but 250 for reliable TODO Another way?
    reportData = parseReportTable()
    if (!isProcessError && !isProcessEnd && testResults.perfomanceSummary.length) {
      const lastRes = testResults.perfomanceSummary[testResults.perfomanceSummary.length - 1] // (!) Previous value maybe in testResults.filteredSummary
      if(reportData.hasOwnProperty(testResults.optParamName) && lastRes.hasOwnProperty(testResults.optParamName) &&
        reportData[testResults.optParamName] !== lastRes[testResults.optParamName]) {
        isProcessEnd = true
        isProcessStart = true
      }
    }
    if((!isProcessError && isProcessEnd) || isIgnoreError) {
      reportData = calculateAdditionValuesToReport(reportData)
    }
    Object.keys(propVal).forEach(key => reportData[`__${key}`] = propVal[key])
    reportData['comment'] = isProcessError ? 'The tradingview error occurred when calculating the strategy based on these parameter values' :
      !isProcessStart ? 'The tradingview calculation process has not started for the strategy based on these parameter values'  :
      !isProcessEnd ? 'The calculation of the strategy parameters took more than 30 seconds for one combination. Testing of this combination is skipped.' : ''

    return {error: isProcessError ? 2 : !isProcessEnd ? 3 : null, message: reportData['comment'], data: reportData}
  }

  async function getResWithBestValue(res, testResults, bestValue, bestPropVal, propVale) {
    let isFiltered = false

    if(res.data.hasOwnProperty(testResults.optParamName)) {
      if(testResults.filterAscending !== null &&
        res.data.hasOwnProperty(testResults.filterParamName) && testResults.hasOwnProperty('filterValue')) {
        if(typeof res.data[testResults.filterParamName] !== 'number' ||
          (testResults.filterAscending && res.data[testResults.filterParamName] < testResults.filterValue) ||
          (!testResults.filterAscending  && res.data[testResults.filterParamName] > testResults.filterValue)
        ) {
          isFiltered = true
          res.data['comment'] = `Skipped for "${testResults.filterParamName}": ${res.data[testResults.filterParamName]}.${res.data['comment'] ? ' ' + res.data['comment'] : ''}`
          res.message = res.data['comment']
          res.isFiltered = true
        }
      }
      if(isFiltered)
        testResults.filteredSummary.push(res.data)
      else
        testResults.perfomanceSummary.push(res.data)
      await storage.setKeys(storage.STRATEGY_KEY_RESULTS, testResults)

      res.currentValue = res.data[testResults.optParamName]
      if(!isFiltered) {
        if(bestValue === null || typeof bestValue === 'undefined') {
          res.bestValue = res.data[testResults.optParamName]
          res.bestPropVal = propVale
          console.log(`Best value (first): ${bestValue} => ${res.bestValue}`)
        } else if(!isFiltered && testResults.isMaximizing) {
          res.bestValue = bestValue < res.data[testResults.optParamName] ? res.data[testResults.optParamName] : bestValue
          res.bestPropVal = bestValue < res.data[testResults.optParamName] ? propVale : bestPropVal
          if(bestValue < res.data[testResults.optParamName]) {
            res.isBestChanged = true
            console.log(`Best value max: ${bestValue} => ${res.bestValue}`)
          } else {
            res.isBestChanged = false
          }

        } else {
          res.bestValue = bestValue > res.data[testResults.optParamName] ? res.data[testResults.optParamName] : bestValue
          res.bestPropVal  = bestValue > res.data[testResults.optParamName] ? propVale : bestPropVal
          if(bestValue > res.data[testResults.optParamName]) {
            res.isBestChanged = true
            console.log(`Best value min: ${bestValue} => ${res.bestValue}`)
          } else {
            res.isBestChanged = false
          }
        }
      } else {
        res.isFiltered = true
      }
    } else {
      res.bestValue = bestValue
      res.bestPropVal = bestPropVal
      res.currentValue = 'error'
    }
    return res
  }

  // Random optimization
  async function optRandomIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState) {
    const propData = optRandomGetPropertiesValues(allRangeParams, bestPropVal)
    let propVal = propData.data

    if(bestPropVal)
      propVal = expandPropVal(propVal, bestPropVal)

    const res = await getTestIterationResult(testResults, propVal)
    if(!res || !res.data || res.error !== null)
      return res
    res.data['comment'] = res.data['comment'] ? res.data['comment'] + propData.message : propData.message
    if (!res.message)
      res.message = propData.message
    else
      res.message += propData.message
    return await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
  }

  function optRandomGetPropertiesValues(allRangeParams, curPropVal) {
    const propVal = {}
    let msg = ''
    const allParamNames = Object.keys(allRangeParams)
    if(curPropVal) {
      allParamNames.forEach(paramName => {
        propVal[paramName] = curPropVal[paramName]
      })
      const indexToChange = randomInteger(0, allParamNames.length - 1)
      const paramName = allParamNames[indexToChange]
      const curVal = propVal[paramName]
      const diffParams = allRangeParams[paramName].filter(paramVal => paramVal !== curVal)
      propVal[paramName] = diffParams.length === 0 ? curVal : diffParams.length === 1 ? diffParams[0] : diffParams[randomInteger(0, diffParams.length - 1)]
      msg = `Changed "${paramName}": ${curVal} => ${propVal[paramName]}.`
    } else {
      allParamNames.forEach(paramName => {
        propVal[paramName] = allRangeParams[paramName][randomInteger(0, allRangeParams[paramName].length - 1)]
      })
      msg = `Changed all parameters.`
    }
    return {message: msg, data: propVal}
  }

  function expandPropVal(propVal, basePropVal) {
    const newPropVal = {}
    Object.keys(basePropVal).forEach(key => {
      if(propVal.hasOwnProperty(key))
        newPropVal[key] = propVal[key]
      else
        newPropVal[key] = basePropVal[key]
    })
    return newPropVal
  }

  async function getInitBestValues(testResults) { // TODO Add get current values(!) to startParams
    if(!testResults.hasOwnProperty('startParams') || !testResults.startParams.hasOwnProperty('current') || !testResults.startParams.current)
      return null

    let resVal =  null
    let resPropVal = testResults.startParams.current
    let resData = null

    function setBestVal (newVal, newPropVal, newResData) {
      if(resVal === null || resPropVal === null) {
        resVal = newVal
        resPropVal = newPropVal
        resData = newResData
      } else if(testResults.isMaximizing && newVal > resVal) {
        resVal = newVal
        resPropVal = newPropVal
        resData = newResData
      } else if(!testResults.isMaximizing && newVal < resVal) {
        resVal = newVal < resVal ? newVal : resVal
        resPropVal =  newVal < resVal ? newPropVal : resPropVal
        resData = newVal < resVal ?  newResData : resData
      }
    }

    resData = parseReportTable()
    resData = calculateAdditionValuesToReport(resData)
    if (resData && resData.hasOwnProperty(testResults.optParamName)) {
      console.log(`Current "${testResults.optParamName}":`,  resData[testResults.optParamName])
      resVal = resData[testResults.optParamName]
      resData['comment'] = resData['comment'] ? `Current parameters. ${resData['comment']}` : 'Current parameters.'
      Object.keys(resPropVal).forEach(key => resData[`__${key}`] = resPropVal[key])
    }


    if(testResults.startParams.hasOwnProperty('default') && testResults.startParams.default) {
      const defPropVal = expandPropVal(testResults.startParams.default, resPropVal)
      if(resPropVal === null || Object.keys(resPropVal).some(key => resPropVal[key] !== defPropVal[key])) {
        const res = await getTestIterationResult(testResults, defPropVal, true) // Ignore error because propValues can be the same
        if(res && res.data && res.data.hasOwnProperty(testResults.optParamName)) {
          console.log(`Default "${testResults.optParamName}":`,  res.data[testResults.optParamName])
          res.data['comment'] = res.data['comment'] ? `Default parameters. ${res.data['comment']}` : 'Default parameters.'
          Object.keys(defPropVal).forEach(key => res.data[`__${key}`] = defPropVal[key])
          setBestVal(res.data[testResults.optParamName], defPropVal, res.data)
        }
      } else {
        console.log(`Default "${testResults.optParamName}" equal current:`, resData[testResults.optParamName])
      }
    }
    if(testResults.startParams.hasOwnProperty('best') && testResults.startParams.best) {
      if(resPropVal === null ||
        (
          (testResults.startParams.current && Object.keys(testResults.startParams.current).some(key => testResults.startParams.current[key] !== testResults.startParams.best[key])) &&
          (testResults.startParams.default && Object.keys(testResults.startParams.default).some(key => testResults.startParams.default[key] !== testResults.startParams.best[key]))
        )
      ) {
        const bestPropVal = expandPropVal(testResults.startParams.best, resPropVal)
        const res = await getTestIterationResult(testResults, bestPropVal, true)  // Ignore error because propValues can be the same
        if (res && res.data && res.data.hasOwnProperty(testResults.optParamName)) {
          console.log(`Best "${testResults.optParamName}":`, res.data[testResults.optParamName])
          res.data['comment'] = res.data['comment'] ? `Best value parameters. ${res.data['comment']}` : 'Best value parameters.'
          Object.keys(bestPropVal).forEach(key => res.data[`__${key}`] = bestPropVal[key])
          setBestVal(res.data[testResults.optParamName], bestPropVal, res.data)
        }

      } else {
        console.log(`Best "${testResults.optParamName}" equal previous (current or default):`, resData[testResults.optParamName])
      }
    }
    console.log(`For init "${testResults.optParamName}":`, resVal)

    if(resVal !== null && resPropVal !== null && resData !== null)
      return {bestValue: resVal, bestPropVal: resPropVal, data: resData}
    return null
  }

  // Annealing optimization
  async function optAnnealingIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState) {
    const initTemp = 1// TODO to param? Find teh best match?
    const isMaximizing = testResults.hasOwnProperty('isMaximizing') ? testResults.isMaximizing : true
    if (!optimizationState.isInit) {
      optimizationState.currentTemp = initTemp

      if(!bestPropVal || bestValue === 'undefined') {
        let propVal = optAnnealingNewState(allRangeParams) // Random value
        if(bestPropVal)
          propVal = expandPropVal(propVal, bestPropVal)
        optimizationState.lastState = propVal
        const res = await getTestIterationResult(testResults, optimizationState.lastState)
        if(!res || !res.data)
          return res

        optimizationState.lastEnergy = res.data[testResults.optParamName]
        optimizationState.bestState = optimizationState.lastState;
        optimizationState.bestEnergy = optimizationState.lastEnergy;
      } else {
        optimizationState.lastState = bestPropVal
        optimizationState.bestState = bestPropVal;
        optimizationState.lastEnergy = bestValue
        optimizationState.bestEnergy = bestValue
      }

      optimizationState.isInit = true
    }
    const iteration = testResults.perfomanceSummary.length


    let propData = optAnnealingNewState(allRangeParams, optimizationState.currentTemp, optimizationState.lastState)
    let propVal = propData.data
    if(bestPropVal)
      propVal = expandPropVal(propVal, bestPropVal)
    const currentState = propVal
    let res = await getTestIterationResult(testResults, currentState)

    if(!res || !res.data || res.error !== null)
      return res
    res.data['comment'] = res.data['comment'] ? res.data['comment'] + propData.message : propData.message
    if (!res.message)
      res.message = propData.message
    else
      res.message += propData.message
    // return await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
    res = await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
    if(!res.data.hasOwnProperty(testResults.optParamName))
      return res
    const currentEnergy = res.data[testResults.optParamName]

    if(res.hasOwnProperty('isBestChanged') && res.isBestChanged) {
      optimizationState.lastState = currentState;
      optimizationState.lastEnergy = currentEnergy;
      res.message += ` The best value ${res.bestValue}.`
    } else {
      const randVal = Math.random()
      const expVal = Math.exp(-(currentEnergy - optimizationState.lastEnergy)/optimizationState.currentTemp) // Math.exp(-10) ~0,000045,  Math.exp(-1) 0.3678 Math.exp(0); => 1
      // console.log('#', optimizationState.currentTemp, randVal, expVal, currentEnergy, optimizationState.lastEnergy, currentEnergy - optimizationState.lastEnergy)
      if (randVal <= expVal) { // TODO need to optimize
        optimizationState.lastState = currentState;
        optimizationState.lastEnergy = currentEnergy;
        // res.message += ' Randomly changed state to current.'
      } else { // To revert to best condition
        optimizationState.lastState = res.bestPropVal;
        optimizationState.lastEnergy = res.bestValue;
        // res.message += ` Returned to best state with best value ${res.bestValue}`
      }
    }
    optimizationState.currentTemp = optAnnealingGetTemp(optimizationState.currentTemp, testResults.cycles);
      // optimizationState.currentTemp = optAnnealingGetBoltzmannTemp(initTemp, iteration, Object.keys(allRangeParams).length);
      // optimizationState.currentTemp = optAnnealingGetExpTemp(initTemp, iteration, Object.keys(allRangeParams).length);
    return res
  }

  function optAnnealingGetTemp(prevTemperature, cylces) {
    return prevTemperature * (1-1/cylces);
  }

  function optAnnealingGetBoltzmannTemp(initTemperature, iter, cylces, dimensionSize) {
    return iter === 1 ? 1 : initTemperature/Math.log(1 + iter/(dimensionSize*2));
  }

  function optAnnealingGetExpTemp(initTemperature, iter, dimensionSize) {
    return initTemperature/Math.pow(iter, 1 / dimensionSize);
  }


  function randomNormalDistribution(min, max) {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) return randomNormalDistribution() // resample between 0 and 1
    else{
      num *= max - min // Stretch to fill range
      num += min // offset to min
    }
    return num
  }


  function optAnnealingNewState(allRangeParams, temperature, curState) {
    const propVal = {} // TODO prepare as
    let msg = ''
    const allParamNames = Object.keys(allRangeParams)
    const isAll = (randomInteger(0, 10) * temperature) >= 5
    if(!isAll && curState) {
        allParamNames.forEach(paramName => {
          propVal[paramName] = curState[paramName]
        })
        const indexToChange = randomInteger(0, allParamNames.length - 1)
        const paramName = allParamNames[indexToChange]
        const curVal = propVal[paramName]
        const diffParams = allRangeParams[paramName].filter(paramVal => paramVal !== curVal)

        if(diffParams.length === 0) {
          propVal[paramName] = curVal
        } else if(diffParams.length === 1) {
          propVal[paramName] = diffParams[0]
        } else {
          propVal[paramName] = diffParams[randomInteger(0, diffParams.length - 1)]

          // Is not proportional chances for edges of array
          // const offset = sign * Math.floor(temperature * randomNormalDistribution(0, (allRangeParams[paramName].length - 1)))
          // const newIndex = curIndex + offset > allRangeParams[paramName].length - 1 ? allRangeParams[paramName].length - 1 : // TODO +/-
          //   curIndex + offset < 0 ? 0 : curIndex + offset
          // propVal[paramName] = allRangeParams[paramName][newIndex]
          // Second variant
          const curIndex = allRangeParams[paramName].indexOf(curState[paramName])
          const sign = randomInteger(0,1) === 0 ? -1 : 1
          const baseOffset = Math.floor(temperature * randomNormalDistribution(0, (allRangeParams[paramName].length - 1)))
          const offsetIndex = (curIndex + sign * baseOffset) % (allRangeParams[paramName].length)
          const newIndex2 = offsetIndex >= 0 ? offsetIndex : allRangeParams[paramName].length + offsetIndex
          propVal[paramName] = allRangeParams[paramName][newIndex2]
        }
        msg = `Changed "${paramName}": ${curVal} => ${propVal[paramName]}.`
    }  else if (isAll) {
      allParamNames.forEach(paramName => {
        const curIndex = allRangeParams[paramName].indexOf(curState[paramName])
        const sign = randomInteger(0,1) === 0 ? -1 : 1
        const baseOffset = Math.floor(temperature * randomNormalDistribution(0, (allRangeParams[paramName].length - 1)))
        const offsetIndex = (curIndex + sign * baseOffset) % (allRangeParams[paramName].length)
        const newIndex2 = offsetIndex >= 0 ? offsetIndex : allRangeParams[paramName].length + offsetIndex
        propVal[paramName] = allRangeParams[paramName][newIndex2]
      })
      msg = `Changed all parameters randomly.`
    }  else {
      allParamNames.forEach(paramName => {
        propVal[paramName] = allRangeParams[paramName][randomInteger(0, allRangeParams[paramName].length - 1)]
      })
      msg = `Changed all parameters randomly without temperature.`
    }
    return {message: msg, data: propVal}
  }

  async function optAnnealingGetEnergy(testResults, propVal) { // TODO 2del test function annealing
    const allDimensionVal = Object.keys(propVal).map(name => Math.abs(propVal[name] * propVal[name] - 16))
    testResults.perfomanceSummary.push(allDimensionVal)
    const resData = {}
    resData[testResults.optParamName] = allDimensionVal.reduce((sum, item) => item + sum, 0)
    return {error: 0, data: resData};
  }

  async function optSequentialIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState) {
    if (!optimizationState.hasOwnProperty('paramIdx')) {
      optimizationState.paramIdx = 0
    }
    let paramName = testResults.paramPriority[optimizationState.paramIdx]
    if (!optimizationState.hasOwnProperty('valIdx')) {
      optimizationState.valIdx = 0
    } else {
      optimizationState.valIdx += 1
      if(optimizationState.valIdx >= allRangeParams[paramName].length) {
        optimizationState.valIdx = 0
        optimizationState.paramIdx += 1
        if( optimizationState.paramIdx >= testResults.paramPriority.length) {
          return null // End
        } else {
          paramName = testResults.paramPriority[optimizationState.paramIdx]
        }
      }
    }
    const valIdx = optimizationState.valIdx


    const propVal = {}
    Object.keys(bestPropVal).forEach(paramName => {
      propVal[paramName] = bestPropVal[paramName]
    })
    propVal[paramName] = allRangeParams[paramName][valIdx]
    if(bestPropVal[paramName] === propVal[paramName])
      return {error: null, currentValue: bestValue, message: `The same value of the "${paramName}" parameter equal to ${propVal[paramName]} is skipped`}
    const msg = `Changed "${paramName}": ${bestPropVal[paramName]} => ${propVal[paramName]}.`

    const res = await getTestIterationResult(testResults, propVal)
    if(!res || !res.data || res.error !== null)
      return res
    res.data['comment'] = res.data['comment'] ? res.data['comment'] + msg : msg
    if (!res.message)
      res.message = msg
    else
      res.message += msg
    return await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
  }

  async function testStrategy(testResults, strategyData, allRangeParams) {
    testResults.perfomanceSummary = []
    testResults.filteredSummary = []
    testResults.shortName = strategyData.name
    console.log('testStrategy', testResults.shortName, testResults.isMaximizing ? 'max' : 'min', 'value of', testResults.optParamName,
      'by', testResults.method,
      (testResults.filterAscending === null ? 'filter off' : 'filter ascending' + testResults.filterAscending + ' value ' +
        testResults.filterValue + ' by ' + testResults.filterParamName),
      testResults.cycles, 'times')
    testResults.paramsNames = Object.keys(allRangeParams)

    // Get best init value and properties values
    let bestValue = null
    let bestPropVal = null
    statusMessage('Get the best initial values.')
    const initRes = await getInitBestValues(testResults, allRangeParams)
    if(initRes && initRes.hasOwnProperty('bestValue') && initRes.bestValue !== null && initRes.hasOwnProperty('bestPropVal') && initRes.hasOwnProperty('data')) {
      testResults.initBestValue = initRes.bestValue
      bestValue = initRes.bestValue
      bestPropVal = initRes.bestPropVal
      testResults.perfomanceSummary.push(initRes.data)
      try {
        statusMessage(`<p>From default and previus test. Best "${testResults.optParamName}": ${bestValue}</p>`)
        console.log('Saved best value', bestValue)
        console.log(testResults.perfomanceSummary)
      } catch {}
    }
    console.log('bestValue', bestValue)
    console.log('bestPropVal', bestPropVal)

    // Test strategy
    const optimizationState = {}
    let isEnd = false
    for(let i = 0; i < testResults.cycles; i++) {
      if (action.workerStatus === null) {
        console.log('Stop command detected')
        break
      }
      let optRes = {}
      switch(testResults.method) {
        case 'annealing':
          optRes = await optAnnealingIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState)
          break
        case 'sequential':
          optRes = await optSequentialIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState)
          if(optRes === null)
            isEnd = true
          break
        case 'random':
        default:
          optRes = await optRandomIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState)
          if(optRes === null)
            isEnd = true
      }
      if(isEnd)
        break
      if(optRes.hasOwnProperty('data') && optRes.hasOwnProperty('bestValue') && optRes.bestValue !== null && optRes.hasOwnProperty('bestPropVal')) {
        bestValue = optRes.bestValue
        bestPropVal = optRes.bestPropVal
        try {
          let text = `<p>Cycle: ${i + 1}/${testResults.cycles}. Best "${testResults.optParamName}": ${bestValue}</p>`
          text += optRes.hasOwnProperty('currentValue') ? `<p>Current "${testResults.optParamName}": ${optRes.currentValue}</p>` : ''
          text += optRes.error !== null  ? `<p style="color: red">${optRes.message}</p>` : optRes.message ? `<p>${optRes.message}</p>` : ''
          statusMessage(text)
        } catch {}
      } else {
        try {
          let text = `<p>Cycle: ${i + 1}/${testResults.cycles}. Best "${testResults.optParamName}": ${bestValue}</p>`
          text += optRes.currentValue ? `<p>Current "${testResults.optParamName}": ${optRes.currentValue}</p>` : `<p>Current "${testResults.optParamName}": error</p>`
          text += optRes.error !== null  ? `<p style="color: red">${optRes.message}</p>` : optRes.message ? `<p>${optRes.message}</p>` : ''
          statusMessage(text)
        } catch {}
      }
    }
    return testResults
  }









  function createParamsFormRange(paramRange) {
    const allRangeParams = {}

    Object.keys(paramRange).forEach(key => {
      if(paramRange[key].length !== 5) {
        console.error('Errors in param length', key, paramRange[key])
      } else if(typeof paramRange[key][0] === 'boolean' && typeof paramRange[key][1] === 'boolean') {
        allRangeParams[key] = [true, false]
      } else if (typeof paramRange[key][0] === 'string' && paramRange[key][1] === '' && paramRange[key][0].includes(';')) {
        allRangeParams[key] = paramRange[key][0].split(';').filter(item => item)
      } else if(paramRange[key][2] === 0) {
        if(paramRange[key][1] !== '')
          allRangeParams[key] = [paramRange[key][0], paramRange[key][1]]
        else
          console.log(`Parameter "${key}" will be skipped, because it have only one value in range`)
          // allRangeParams[key] = [paramRange[key][0]] // Or skip this param?
      } else if (typeof  paramRange[key][0] === 'number' && typeof paramRange[key][1] === 'number' && typeof paramRange[key][2] === 'number') {
        allRangeParams[key] = []
        for(let i = paramRange[key][0]; i < paramRange[key][1]; i = i + paramRange[key][2])
          allRangeParams[key].push(i)
        if(allRangeParams[key][allRangeParams[key].length - 1] < paramRange[key][1])
          allRangeParams[key].push(paramRange[key][1])
      } else {
        console.error('Unsupported param values combination', key, paramRange[key])
      }
    })
    return allRangeParams
  }

  function getParamPriorityList(paramRange) {
    const paramPriorityPair = {}
    const priorityList = []
    Object.keys(paramRange).forEach(key => paramRange[key].length === 5 ? priorityList.push(paramRange[key][4]) : null)
    let maxVal = Math.max.apply(null, priorityList)
    maxVal = Math.max(maxVal, Object.keys(paramRange).length)
    Object.keys(paramRange).forEach(key => {
      if(paramRange[key].length !== 5) {
        console.error('Errors in param length', key, paramRange[key])
      } else {
        const idx = paramRange[key][4] * maxVal
        if(paramPriorityPair.hasOwnProperty(idx)) {
          for(let i = 1; i < maxVal; i++) {
            if(!paramPriorityPair.hasOwnProperty(idx + i)) {
              paramPriorityPair[idx + i] = key
              break
            }
          }
        } else {
          paramPriorityPair[idx] = key
        }
      }
    })
    const sortedPriority = Object.keys(paramPriorityPair).sort((a, b) => a - b)
    const paramPriorityList = []
    sortedPriority.forEach(idx => paramPriorityList.push(paramPriorityPair[idx]))
    return paramPriorityList
  }

  async function getStartParamValues(paramRange, strategyData) {
    const currenPropVal = getCurrentPropValues(strategyData)
    const startValues = {'default': {}, 'current': currenPropVal}

    Object.keys(paramRange).forEach(key => {
      if(paramRange[key].length !== 5)
        console.error('Errors in param length', key, paramRange[key])
      else
        startValues.default[key] = paramRange[key][3]
    })

    const testResults = await storage.getKey(storage.STRATEGY_KEY_RESULTS)
    if(testResults && testResults.perfomanceSummary && testResults.perfomanceSummary.length) {
      const bestResult = testResults.perfomanceSummary ? getBestResult(testResults) : {}
      const allParamsName = Object.keys(startValues.default)
      if(bestResult) {
        const propVal = {}
        testResults.paramsNames.forEach(paramName => {
          if(bestResult.hasOwnProperty(`__${paramName}`))
            propVal[paramName] = bestResult[`__${paramName}`]
        })
        if(propVal && Object.keys(propVal).every(key => allParamsName.includes(key)))
          startValues.best = propVal
      }
    }
    return startValues
  }



  function getCurrentPropValues(strategyData) {
    const propVal = {}
    Object.keys(strategyData.properties).forEach(key => {
      if (typeof strategyData.properties[key] === 'string' && strategyData.properties[key].includes(';'))
        propVal[key] = strategyData.properties[key].split(';')[0]
      else
        propVal[key] = strategyData.properties[key]
    })
    return propVal
  }


  function strategyRangeToTemplate(paramRange) {
    let csv = 'Parameter,From,To,Step,Default,Priority\n'
    Object.keys(paramRange).forEach(key => {
      csv += `${JSON.stringify(key)},${typeof paramRange[key][0] === 'string' ? JSON.stringify(paramRange[key][0]) : paramRange[key][0]},`+
        `${paramRange[key][1]},${paramRange[key][2]},${typeof paramRange[key][3] === 'string' ? JSON.stringify(paramRange[key][3]) : paramRange[key][3]},${paramRange[key][4]}\n`
    })
    return csv
  }

  function shiftToTimeframe(data, tfValues, tfType) {
    switch (tfType.toLowerCase()) {
      case 'd':
        return data.map(dt => {
          if(dt.getUTCDate() % tfValues !== 0) {
            dt.setUTCDate(dt.getUTCDate() - dt.getUTCDate() % tfValues)
          }
          dt.setUTCHours(0, 0, 0, 0)
          return dt
        })
      case 'h':
        return data.map(dt => {
          if(dt.getUTCHours() % tfValues !== 0)
            dt.setUTCHours(dt.getUTCHours() - dt.getUTCHours() % tfValues, 0, 0, 0)
          else
            dt.setUTCMinutes( 0, 0, 0)
          return dt
        })
      case 'm':
        return data.map(dt => {
          if(dt.getUTCMinutes() % tfValues !== 0)
            dt.setUTCMinutes( dt.getUTCMinutes() - dt.getUTCMinutes() % tfValues, 0, 0)
          else
            dt.setUTCSeconds( 0, 0)
          return dt
        })
      default:
        return []
    }
  }

  function parseTF(tf) {
    if(tf.length < 2)
      return [null, null]
    const tfType = (tf[tf.length - 1]).toLowerCase()
    const tfVal = parseInt(tf.substring(0, tf.length - 1), 10)
    if(tfVal)
      return [tfVal, tfType]
    return [null, null]
  }

  async function parseTSSignalsAndGetMsg (fileData) {
    try {
      const csvData = await file.parseCSV(fileData)
      const headers = Object.keys(csvData[0])
      const missColumns = ['timestamp', 'ticker', 'timeframe', 'signal'].filter(columnName => !headers.includes(columnName))
      if(missColumns && missColumns.length)
        return `  - ${fileData.name}: There is no column(s) "${missColumns.join(', ')}" in CSV. Please add all necessary columns to CSV like showed in the template. Uploading canceled.\n`
      const tickersAndTFSignals = {}
      for(let row of csvData) { // Prepare timestamp arrays
        if(row['timestamp'] && row['signal'] && row['ticker'] && row['timeframe'] && row['timeframe'].length >= 2) {
          try {
            const [tfVal, tfType] = parseTF(row['timeframe'])
            if(!['h', 'm', 'd'].includes(tfType) || !(tfVal > 0))
              return `  - ${fileData.name}: only minute(m) and hour(h) timeframes are supported. There is a timeframe "${row['timeframe']}" in the file. Uploading canceled.\n`
            const tktfName = `${row['ticker']}::${tfVal}${tfType}`.toLowerCase()
            if(!tickersAndTFSignals.hasOwnProperty(tktfName))
              tickersAndTFSignals[tktfName] = {tsBuy: [], tsSell: []}
            const ts = new Date(row['timestamp'])
            if(!isNaN(ts.getTime())) {
              if(row['signal'].toLowerCase().includes('buy'))
                tickersAndTFSignals[tktfName].tsBuy.push(ts)
              else if (row['signal'].toLowerCase().includes('sell'))
                tickersAndTFSignals[tktfName].tsSell.push(ts)
            } else {
              console.error(`Timestamp ${row['timestamp']} ${typeof(row['timestamp'])} isn't valid`)
            }
          } catch (err) {
            console.error(err)
          }
        }
      }
      let msgArr = []
      for(let tktfName of Object.keys(tickersAndTFSignals)) {
        try {
          const tf = tktfName.split('::').pop()
          const [tfVal, tfType] = parseTF(tf)
          if(!tfVal || !tfType) continue
          const buyArr = shiftToTimeframe(tickersAndTFSignals[tktfName].tsBuy, tfVal, tfType)
          const buyConv = buyArr.map(dt => dt.getTime())
          const sellArr = shiftToTimeframe(tickersAndTFSignals[tktfName].tsSell,  tfVal, tfType)
          const sellConv = sellArr.map(dt => dt.getTime())
          await storage.setKeys(`${storage.SIGNALS_KEY_PREFIX}_${tktfName}`,  {buy: buyConv.filter((item, idx) => buyConv.indexOf(item) === idx).join(','),
            sell: sellConv.filter((item, idx) => sellConv.indexOf(item) === idx).join(','),
            loadData: (new Date()).toISOString()})
          console.log(`For ${tktfName} loaded ${buyConv.length + sellConv.length} timestamps`)
          msgArr.push(`${tktfName} (${buyConv.length + sellConv.length})`)
        } catch (err) {
          console.error(err)
        }
      }
      return `- ${fileData.name}. Timestamps saved for tickers: ${msgArr.join(', ')}. Data saved in storage.\n`
    } catch (err) {
      console.error(fileData.name)
      console.error(err)
      return `- ${fileData.name}: ${err.message}\n`
    }
  }

  async function parseStrategyParamsAndGetMsg (fileData) {
    console.log('parsStrategyParamsAndGetMsg filename', fileData)
    const paramRange = {}
    const csvData = await file.parseCSV(fileData)
    const headers = Object.keys(csvData[0])
    const missColumns = ['parameter','from','to','step','default','priority'].filter(columnName => !headers.includes(columnName.toLowerCase()))
    if(missColumns && missColumns.length)
      return `  - ${fileData.name}: There is no column(s) "${missColumns.join(', ')}" in CSV.\nPlease add all necessary columns to CSV like showed in the template.\n\nUploading canceled.\n`
    csvData.forEach(row => paramRange[row['parameter']] = [row['from'], row['to'], row['step'], row['default'], row['priority']])
    await storage.setKeys(storage.STRATEGY_KEY_PARAM, paramRange)
    console.log(paramRange)
    return `The data was saved in the storage. \nTo use them for repeated testing, click on the "Test strategy" button in the extension pop-up window.`
  }







  async function tvDialogHandler () {
    const indicatorTitle = page.getTextForSel(SEL.indicatorTitle)
    if(!document.querySelector(SEL.okBtn) || !document.querySelector(SEL.tabInput))
      return
    if(indicatorTitle === 'iondvSignals' && action.workerStatus === null) {
      let tickerText = document.querySelector(SEL.ticker).innerText
      let timeFrameEl = document.querySelector(SEL.timeFrameActive)
      if(!timeFrameEl)
        timeFrameEl = document.querySelector(SEL.timeFrame)


      let timeFrameText = timeFrameEl.innerText
      if(!tickerText || !timeFrameText)
        // alert('There is not timeframe element on page. Open correct page please')
        return

      timeFrameText = timeFrameText.toLowerCase() === 'd' ? '1D' : timeFrameText
      if (isMsgShown && tickerText === tickerTextPrev && timeFrameText === timeFrameTextPrev)
        return
      tickerTextPrev = tickerText
      timeFrameTextPrev = timeFrameText

      if(!await tv.changeDialogTabToInput()) {
        console.error(`Can't set parameters tab to input`)
        isMsgShown = true
        return
      }

      console.log("Tradingview indicator parameters window opened for ticker:", tickerText);
      const tsData = await storage.getKey(`${storage.SIGNALS_KEY_PREFIX}_${tickerText}::${timeFrameText}`.toLowerCase())
      if(tsData === null) {
        alert(`No data was loaded for the ${tickerText} and timeframe ${timeFrameText}.\n\n` +
          `Please change the ticker and timeframe to correct and reopen script parameter window.`)
        isMsgShown = true
        return
      }
      isMsgShown = false

      const indicProperties = document.querySelectorAll(SEL.indicatorProperty)

      const propVal = {
        TSBuy: tsData && tsData.hasOwnProperty('buy') ? tsData.buy : '',
        TSSell: tsData && tsData.hasOwnProperty('sell') ? tsData.sell : '',
        Ticker: tickerText,
        Timeframe: timeFrameText
      }
      const setResult = []
      const propKeys = Object.keys(propVal)
      for(let i = 0; i < indicProperties.length; i++) {
        const propText = indicProperties[i].innerText
        if(propKeys.includes(propText)) {
          setResult.push(propText)
          page.setInputElementValue(indicProperties[i + 1].querySelector('input'), propVal[propText])
          if(propKeys.length === setResult.length)
            break
        }
      }
      const notFoundParam = propKeys.filter(item => !setResult.includes(item))
      if(notFoundParam && notFoundParam.length) {
        alert(`One of the parameters named ${notFoundParam} was not found in the window. Check the script.\n`)
        isMsgShown = true
        return
      }
      document.querySelector(SEL.okBtn).click()
      const allSignals = [].concat(tsData.buy.split(','),tsData.sell.split(',')).sort()
      alert(`${allSignals.length} signals are set.\n  - date of the first signal: ${new Date(parseInt(allSignals[0]))}.\n  - date of the last signal: ${new Date(parseInt(allSignals[allSignals.length - 1]))}`)
      isMsgShown =  true
    }
  }

  const dialogWindowNode = await page.waitForSelector(SEL.tvDialogRoot, 0)
  if(dialogWindowNode) {
    const tvObserver = new MutationObserver(tvDialogHandler);
    tvObserver.observe(dialogWindowNode, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
    await tvDialogHandler() // First run
  }

})();