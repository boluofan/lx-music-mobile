import { playList } from '@/core/player/player'
import { useMemo, useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type FlatListProps, PanResponder, Animated } from 'react-native'

import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { getListPosition, getListPrevSelectId, saveListPosition } from '@/utils/data'
// import { useMusicList } from '@/store/list/hook'
import { getListMusics, setActiveList, updateListMusicPosition } from '@/core/list'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import { createStyle, getRowInfo } from '@/utils/tools'
import { usePlayInfo, usePlayMusicInfo } from '@/store/player/hook'
import type { Position } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useActiveListId } from '@/store/list/hook'
import { useSettingValue } from '@/store/setting/hook'

type FlatListType = FlatListProps<LX.Music.MusicInfo>

export interface ListProps {
  onShowMenu: (musicInfo: LX.Music.MusicInfo, index: number, position: Position) => void
  onMuiltSelectMode: () => void
  onSelectAll: (isAll: boolean) => void
}
export interface ListType {
  setIsMultiSelectMode: (isMultiSelectMode: boolean) => void
  setSelectMode: (mode: SelectMode) => void
  selectAll: (isAll: boolean) => void
  getSelectedList: () => LX.List.ListMusics
  scrollToInfo: (info: LX.Music.MusicInfo) => void
  scrollToTop: () => void
  setDragMode: (isDragMode: boolean, musicInfo?: LX.Music.MusicInfo, index?: number) => void
}

const usePlayIndex = () => {
  const activeListId = useActiveListId()
  const playMusicInfo = usePlayMusicInfo()
  const playInfo = usePlayInfo()

  const playIndex = useMemo(() => {
    return playMusicInfo.listId == activeListId ? playInfo.playIndex : -1
  }, [activeListId, playInfo.playIndex, playMusicInfo.listId])

  return playIndex
}


const List = forwardRef<ListType, ListProps>(({ onShowMenu, onMuiltSelectMode, onSelectAll }, ref) => {
  // const t = useI18n()
  const flatListRef = useRef<FlatList>(null)
  const [currentList, setList] = useState<LX.List.ListMusics>([])
  const listFirstScrollRef = useRef(false)
  const isMultiSelectModeRef = useRef(false)
  const selectModeRef = useRef<SelectMode>('single')
  const prevSelectIndexRef = useRef(-1)
  const [selectedList, setSelectedList] = useState<LX.List.ListMusics>([])
  const selectedListRef = useRef<LX.List.ListMusics>([])
  const currentListIdRef = useRef('')
  const waitJumpListPositionRef = useRef(false)
  const rowInfo = useRef(getRowInfo())
  const isShowAlbumName = useSettingValue('list.isShowAlbumName')
  const isShowInterval = useSettingValue('list.isShowInterval')

  // 拖拽相关状态
  const [isDragMode, setIsDragMode] = useState(false)
  const [dragItem, setDragItem] = useState<LX.Music.MusicInfo | null>(null)
  const [dragIndex, setDragIndex] = useState(-1)
  const dragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current
  const dragOpacity = useRef(new Animated.Value(1)).current
  const [hoveredIndex, setHoveredIndex] = useState(-1)

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => isDragMode && dragItem !== null,
    onMoveShouldSetPanResponder: () => isDragMode && dragItem !== null,
    onPanResponderMove: (_, gestureState) => {
      if (!isDragMode || dragItem === null) return

      dragPosition.setValue({ x: 0, y: gestureState.dy })

      // 计算当前拖拽位置对应的索引
      const rowNum = rowInfo.current.rowNum ?? 1
      const itemHeight = ITEM_HEIGHT
      const row = Math.floor(gestureState.moveY / itemHeight)
      const col = Math.floor(gestureState.moveX / (itemHeight / rowNum))
      const currentIndex = row * rowNum + col

      if (currentIndex !== hoveredIndex && currentIndex >= 0 && currentIndex < currentList.length) {
        setHoveredIndex(currentIndex)
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (!isDragMode || dragItem === null) return

      const rowNum = rowInfo.current.rowNum ?? 1
      const itemHeight = ITEM_HEIGHT
      const row = Math.floor(gestureState.moveY / itemHeight)
      const col = Math.floor(gestureState.moveX / (itemHeight / rowNum))
      const targetIndex = row * rowNum + col

      if (targetIndex >= 0 && targetIndex < currentList.length && targetIndex !== dragIndex) {
        handleMoveToPosition(dragIndex, targetIndex)
      }

      handleDragEnd()
      setHoveredIndex(-1)
    },
  })).current
  // console.log('render music list')

  useImperativeHandle(ref, () => ({
    setIsMultiSelectMode(isMultiSelectMode) {
      isMultiSelectModeRef.current = isMultiSelectMode
      if (!isMultiSelectMode) {
        prevSelectIndexRef.current = -1
        handleUpdateSelectedList([])
      }
    },
    setSelectMode(mode) {
      selectModeRef.current = mode
      // 如果切换到拖拽模式，退出多选模式
      if (mode === 'drag') {
        setIsDragMode(true)
        isMultiSelectModeRef.current = false
        prevSelectIndexRef.current = -1
        handleUpdateSelectedList([])
      } else {
        setIsDragMode(false)
        setDragItem(null)
        setDragIndex(-1)
      }
    },
    selectAll(isAll) {
      let list: LX.List.ListMusics
      if (isAll) {
        list = [...currentList]
      } else {
        list = []
      }
      selectedListRef.current = list
      setSelectedList(list)
    },
    getSelectedList() {
      return selectedListRef.current
    },
    scrollToInfo(info) {
      void getListMusics(listState.activeListId).then((list) => {
        const index = list.findIndex(m => m.id == info.id)
        if (index < 0) return
        flatListRef.current?.scrollToIndex({ index: Math.floor(index / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: true })
      })
    },
    scrollToTop() {
      flatListRef.current?.scrollToOffset({
        offset: 0,
        animated: true,
      })
    },
    setDragMode(isDragMode, musicInfo, index) {
      setIsDragMode(isDragMode)
      if (isDragMode && musicInfo && index !== undefined) {
        setDragItem(musicInfo)
        setDragIndex(index)
      } else {
        setDragItem(null)
        setDragIndex(-1)
      }
    },
  }))

  useEffect(() => {
    let isUpdateingList = true
    const updateList = (id: string) => {
      if (currentListIdRef.current == id) return
      isUpdateingList = true
      setList([])
      currentListIdRef.current = id
      void Promise.all([getListMusics(id), getListPosition(id)]).then(([list, position]) => {
        requestAnimationFrame(() => {
          if (currentListIdRef.current != id) return
          selectedListRef.current = []
          setSelectedList([])
          setList([...list])
          requestAnimationFrame(() => {
            isUpdateingList = false
            listFirstScrollRef.current = true
            if (waitJumpListPositionRef.current) {
              waitJumpListPositionRef.current = false
              if (playerState.playMusicInfo.listId == id && playerState.playInfo.playIndex > -1) {
                try {
                  flatListRef.current?.scrollToIndex({ index: Math.floor(playerState.playInfo.playIndex / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: false })
                  return
                } catch {}
              }
            }
            flatListRef.current?.scrollToOffset({ offset: position, animated: false })
          })
        })
      })
    }
    const handleChange = (ids: string[]) => {
      if (!ids.includes(listState.activeListId)) return
      const id = listState.activeListId
      void getListMusics(id).then((list) => {
        if (currentListIdRef.current != id) return
        selectedListRef.current = []
        setSelectedList([])
        setList([...list])
      })
    }

    const handleJumpPosition = () => {
      requestAnimationFrame(() => {
        const listId = playerState.playMusicInfo.listId
        if (!listId) return
        if (listId != listState.activeListId) {
          setActiveList(listId)
          if (currentListIdRef.current != listId) waitJumpListPositionRef.current = true
        } else if (playerState.playInfo.playIndex > -1) {
          if (isUpdateingList) waitJumpListPositionRef.current = true
          else {
            try {
              flatListRef.current?.scrollToIndex({ index: Math.floor(playerState.playInfo.playIndex / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: true })
            } catch {}
          }
        }
      })
    }
    if (global.lx.jumpMyListPosition) {
      global.lx.jumpMyListPosition = false
      if (playerState.playMusicInfo.listId) {
        waitJumpListPositionRef.current = true
        updateList(playerState.playMusicInfo.listId)
      } else void getListPrevSelectId().then(updateList)
    } else void getListPrevSelectId().then(updateList)

    global.state_event.on('mylistToggled', updateList)
    global.app_event.on('myListMusicUpdate', handleChange)
    global.app_event.on('jumpListPosition', handleJumpPosition)

    return () => {
      global.state_event.off('mylistToggled', updateList)
      global.app_event.off('myListMusicUpdate', handleChange)
      global.app_event.off('jumpListPosition', handleJumpPosition)
    }
  }, [])

  const activeIndex = usePlayIndex()
  const handlePlay = (index: number) => {
    void playList(listState.activeListId, index)
  }

  const handleUpdateSelectedList = (newList: LX.List.ListMusics) => {
    if (selectedListRef.current.length && newList.length == currentList.length) onSelectAll(true)
    else if (selectedListRef.current.length == currentList.length) onSelectAll(false)
    selectedListRef.current = newList
    setSelectedList(newList)
  }
  const handleSelect = (item: LX.Music.MusicInfo, pressIndex: number) => {
    let newList: LX.List.ListMusics
    if (selectModeRef.current == 'single') {
      prevSelectIndexRef.current = pressIndex
      const index = selectedListRef.current.indexOf(item)
      if (index < 0) {
        newList = [...selectedListRef.current, item]
      } else {
        newList = [...selectedListRef.current]
        newList.splice(index, 1)
      }
    } else {
      if (selectedListRef.current.length) {
        const prevIndex = prevSelectIndexRef.current
        const currentIndex = pressIndex
        if (prevIndex == currentIndex) {
          newList = []
        } else if (currentIndex > prevIndex) {
          newList = currentList.slice(prevIndex, currentIndex + 1)
        } else {
          newList = currentList.slice(currentIndex, prevIndex + 1)
          newList.reverse()
        }
      } else {
        newList = [item]
        prevSelectIndexRef.current = pressIndex
      }
    }

    handleUpdateSelectedList(newList)
  }

  const handlePress = (item: LX.Music.MusicInfo, index: number) => {
    // console.log(global.lx.homePagerIdle)
    requestAnimationFrame(() => {
      // console.log(global.lx.homePagerIdle)
      if (!global.lx.homePagerIdle) return
      if (isMultiSelectModeRef.current) {
        handleSelect(item, index)
      } else {
        handlePlay(index)
      }
    })
  }

  const handleLongPress = (item: LX.Music.MusicInfo, index: number) => {
    if (isMultiSelectModeRef.current) return
    prevSelectIndexRef.current = index
    handleUpdateSelectedList([item])
    onMuiltSelectMode()
  }

  const handleDragStart = (item: LX.Music.MusicInfo, index: number) => {
    if (selectModeRef.current !== 'drag') return
    setDragItem(item)
    setDragIndex(index)
    setHoveredIndex(-1)

    // 重置拖拽位置
    dragPosition.setValue({ x: 0, y: 0 })

    // 开始拖拽动画
    Animated.parallel([
      Animated.timing(dragOpacity, {
        toValue: 0.8,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start()
  }

  const handleDragEnd = () => {
    if (!dragItem || dragIndex === -1) return

    Animated.parallel([
      Animated.timing(dragOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(dragPosition, {
        toValue: { x: 0, y: 0 },
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDragItem(null)
      setDragIndex(-1)
      setHoveredIndex(-1)
    })
  }

  const handleMoveToPosition = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const newList = [...currentList]
    const [movedItem] = newList.splice(fromIndex, 1)
    newList.splice(toIndex, 0, movedItem)
    setList(newList)

    // 更新实际列表位置
    void updateListMusicPosition(listState.activeListId, toIndex, [movedItem.id])
  }

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (listFirstScrollRef.current) {
      listFirstScrollRef.current = false
      return
    }
    void saveListPosition(listState.activeListId, nativeEvent.contentOffset.y)
  }


  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    const isDragging = isDragMode && dragItem?.id === item.id
    const isHovered = hoveredIndex === index && isDragMode && dragItem?.id !== item.id

    const itemComponent = (
      <ListItem
        item={item}
        index={index}
        activeIndex={activeIndex}
        onPress={handlePress}
        onLongPress={selectModeRef.current === 'drag' ? () => { handleDragStart(item, index) } : handleLongPress}
        onShowMenu={onShowMenu}
        selectedList={selectedList}
        rowInfo={rowInfo.current}
        isShowAlbumName={isShowAlbumName}
        isShowInterval={isShowInterval}
      />
    )

    if (isDragging) {
      return (
        <Animated.View
          style={{
            opacity: dragOpacity,
            transform: [
              { scale: 1.05 },
              { translateY: dragPosition.y },
            ],
            elevation: 8,
            zIndex: 100,
          }}
          {...panResponder.panHandlers}
        >
          {itemComponent}
        </Animated.View>
      )
    }

    return (
      <Animated.View
        style={{
          opacity: isHovered ? 0.5 : 1,
          transform: isHovered ? [{ scale: 0.95 }] : [],
          elevation: isHovered ? 4 : 0,
          zIndex: isHovered ? 50 : 0,
        }}
      >
        {itemComponent}
      </Animated.View>
    )
  }
  const getkey: FlatListType['keyExtractor'] = item => item.id
  const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
    return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
  }

  return (
    <FlatList
      ref={flatListRef}
      onScroll={handleScroll}
      style={styles.list}
      data={currentList}
      maxToRenderPerBatch={4}
      numColumns={rowInfo.current.rowNum}
      horizontal={false}
      // updateCellsBatchingPeriod={80}
      windowSize={8}
      removeClippedSubviews={true}
      initialNumToRender={12}
      renderItem={renderItem}
      keyExtractor={getkey}
      extraData={activeIndex}
      getItemLayout={getItemLayout}
    />
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
})

export default List
