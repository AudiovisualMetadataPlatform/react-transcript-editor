// code obtained from https://github.com/bbc/stt-align-node

import { toWords } from 'number-to-words';
import { diffArrays } from 'diff';
import everpolate from 'everpolate';

/**
 * https://stackoverflow.com/questions/175739/built-in-way-in-javascript-to-check-if-a-string-is-a-valid-number
 * @param {*}  num
 * @return {boolean} - if it's a number true, if it's not false.
 */
function isANumber(num) {
  return !isNaN(num);
}

function removeTrailingPunctuation(str) {
  return str.replace(/\.$/, '');
}

/**
 * removes capitalization, punctuation and converts numbers to letters
 * @param {string} wordText - word text
 * @return {string}
 * handles edge case if word is undefined, and returns undefined in that instance
 */
function normaliseWord(wordText) {
  if (wordText) {
    const wordTextResult = wordText.toLowerCase().trim().replace(/[^a-z|0-9|.]+/g, '');
    if (isANumber(wordTextResult)) {
      const sanitizedWord = removeTrailingPunctuation(wordTextResult);
      if (sanitizedWord !== '') {
        return toWords(sanitizedWord);
      }
    }

    return wordTextResult;
  } else {
    return wordText;
  }
}

// using neighboring words to set missing start and end time when present
function interpolationOptimization(wordsList) {
  return wordsList.map((word, index) => {
    let wordTmp = word;
    // setting the start time of each unmatched word to the previous word’s end time - when present
    // does not first element in list edge case

    if (('start' in word) && (index !== 0)) {
      const previousWord = wordsList[index - 1];
      if ('end' in previousWord) {
        wordTmp = {
          start: previousWord.end,
          end: word.end,
          word: word.word
        };
      }
    }
    // TODO: handle first item ?
    // setting the end time of each unmatched word to the next word’s start time - when present
    // does handle last element in list edge case
    if (('end' in word) && (index !== (wordsList.length - 1))) {
      const nextWord = wordsList[index + 1];
      if ('start' in nextWord) {
        wordTmp = {
          end: nextWord.start,
          start: word.start,
          word: word.word
        };
      }
    }

    // TODO: handle last item ?
    return wordTmp;
  });
}

// after the interpolation, some words have overlapping timecodes.
// the end time of the previous word is greater then the start of the current word
// altho negligible when using in a transcript editor context
// we want to avoid this, coz it causes issues when using the time of the words to generate
// auto segmented captions. As it results in sentence
// boundaries overlapping on screen during playback
function adjustTimecodesBoundaries(words) {

  return words.map((word, index, arr) => {
    // excluding first element
    if (index != 0 ) {
      const previousWord = arr[index - 1];
      const currentWord = word;
      if (previousWord.end > currentWord.start) {
        word.start = previousWord.end;
      }

      return word;
    }

    return word;
  });
}

function interpolate(wordsList) {
  // bypass interpolationOptimization step to fix timestamp sync issue
  // const words = interpolationOptimization(wordsList);
  const indicies = [ ...Array(wordsList.length).keys() ];
  const indiciesWithStart = [];
  const indiciesWithEnd = [];
  const startTimes = [];
  const endTimes = [];

  wordsList.forEach((word, index) => {
    if ('start' in word) {
      indiciesWithStart.push(index);
      startTimes.push(word.start);
    }

    if ('end' in word) {
      indiciesWithEnd.push(index);
      endTimes.push(word.end);
    }
  });
  // http://borischumichev.github.io/everpolate/#linear
  const outStartTimes = everpolate.linear(indicies, indiciesWithStart, startTimes);
  const outEndTimes = everpolate.linear(indicies, indiciesWithEnd, endTimes);
  const wordsResults = wordsList.map((word, index) => {
    if (!('start' in word)) {
      word.start = outStartTimes[index];
    }
    if (!('end' in word)) {
      word.end = outEndTimes[index];
    }

    return word;
  });

  return adjustTimecodesBoundaries(wordsResults);
}

/**
 *
 * @param {array} sttWords - array of STT words
 * @param {array} transcriptWords - array of base text accurate words
 */
function alignWords(sttWords, transcriptWords) {
  // # convert words to lowercase and remove numbers and special characters
  const sttWordsStripped = sttWords.map((word) => {
    return normaliseWord(word.word);
  });

  const transcriptWordsStripped = transcriptWords.map((word) => {
    return normaliseWord(word);
  });
  // # create empty list to receive data
  const transcriptData = [];
  // empty objects as place holder
  transcriptWords.forEach(() => {
    transcriptData.push({});
  });
  // # populate transcriptData with matching words
  // // if they are same length, just interpolate words ?
  const diff = diffArrays(sttWordsStripped, transcriptWordsStripped);
  
  let sttIndex = 0;
  let transcriptIndex = 0;
  
  diff.forEach(part => {
    if (part.added) {
      transcriptIndex += part.count;
    } else if (part.removed) {
      sttIndex += part.count;
    } else {
      for (let i = 0; i < part.count; i++) {
        transcriptData[transcriptIndex] = { ...sttWords[sttIndex] };
        sttIndex++;
        transcriptIndex++;
      }
    }
  });
  
  // Replace words with originals
  transcriptData.forEach((wordObject, index) => {
    wordObject.word = transcriptWords[index];
  });
 
  // # fill in missing timestamps
  return interpolate(transcriptData);
}

export default alignWords;
